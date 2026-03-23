#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { open } from "node:fs/promises";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── 配置 ────────────────────────────────────────────────────────────────────

const DEFAULT_BASE_URL = "https://ilinkai.weixin.qq.com";
const BOT_TYPE = "3";

// 获取用户主目录
const HOME_DIR = process.env.HOME || process.env.USERPROFILE;
const TOKEN_FILE = path.join(HOME_DIR, '.nullclaw', '.weixin-token.json');
const CHANNEL_VERSION = "1.0.2";

class WeChatCLI {
  constructor() {
    this.session = null;
    this.messageIdCounter = 0;
    this.isRunning = false;
    this.rl = null;
    this.lastSenderId = null;
  }

  log(message) {
    console.log(`[wechat-cli] ${message}`);
  }

  error(message) {
    console.error(`[wechat-cli] ERROR: ${message}`);
  }

  // ─── HTTP 工具 ────────────────────────────────────────────────────────────────
  
  randomWechatUin() {
    const uint32 = crypto.randomBytes(4).readUInt32BE(0);
    return Buffer.from(String(uint32), "utf-8").toString("base64");
  }

  buildHeaders(token, body) {
    const headers = {
      "Content-Type": "application/json",
      AuthorizationType: "ilink_bot_token",
      "X-WECHAT-UIN": this.randomWechatUin(),
    };
    if (body !== undefined) {
      headers["Content-Length"] = String(Buffer.byteLength(JSON.stringify(body), "utf-8"));
    }
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    return headers;
  }

  async apiGet(baseUrl, path) {
    const url = `${baseUrl.replace(/\/$/, "")}/${path}`;
    this.log(`GET: ${url}`);
    try {
      const res = await fetch(url);
      const text = await res.text();
      this.log(`响应状态: ${res.status}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${text}`);
      return JSON.parse(text);
    } catch (error) {
      this.error(`GET 请求失败: ${error.message}`);
      throw error;
    }
  }

  async apiPost(baseUrl, endpoint, body, token, timeoutMs = 15_000) {
    const url = `${baseUrl.replace(/\/$/, "")}/${endpoint}`;
    const payload = { ...body, base_info: { channel_version: CHANNEL_VERSION } };
    const bodyStr = JSON.stringify(payload);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: this.buildHeaders(token, payload),
        body: bodyStr,
        signal: controller.signal,
      });
      clearTimeout(timer);
      const text = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${text}`);
      return JSON.parse(text);
    } catch (err) {
      clearTimeout(timer);
      if (err.name === "AbortError") return null;
      throw err;
    }
  }

  async uploadFile(filePath) {
    if (!this.session) {
      throw new Error("未登录");
    }
    
    const { token, baseUrl } = this.session;
    const fileStats = fs.statSync(filePath);
    const fileName = path.basename(filePath);
    const fileBuffer = fs.readFileSync(filePath);
    
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60_000);

    const endpoints = [
      'ilink/bot/uploadmedia',
      'ilink/bot/upload',
      'ilink/bot/upload_file',
      'ilink/bot/media/upload'
    ];

    let lastError = null;

    for (const endpoint of endpoints) {
      try {
        this.log(`尝试上传端点: ${endpoint}`);
        const url = `${baseUrl.replace(/\/$/, "")}/${endpoint}`;
        
        const boundary = `----WebKitFormBoundary${Date.now()}`;
        
        const header = Buffer.from([
          `--${boundary}\r\n`,
          `Content-Disposition: form-data; name="file"; filename="${fileName}"\r\n`,
          `Content-Type: application/octet-stream\r\n\r\n`,
        ].join(''));
        
        const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
        
        const formData = Buffer.concat([header, fileBuffer, footer]);
        
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${token}`,
            "AuthorizationType": "ilink_bot_token",
            "X-WECHAT-UIN": this.randomWechatUin(),
            "Content-Type": `multipart/form-data; boundary=${boundary}`,
            "Content-Length": formData.length,
          },
          body: formData,
          signal: controller.signal,
        });
        clearTimeout(timer);
        const text = await res.text();
        
        if (res.ok) {
          const result = JSON.parse(text);
          this.log(`✅ 上传成功，端点: ${endpoint}`);
          return result.url || result.media_id || result.file_url;
        } else {
          lastError = `HTTP ${res.status}: ${text}`;
          this.log(`❌ 端点 ${endpoint} 返回错误: ${lastError}`);
        }
      } catch (err) {
        clearTimeout(timer);
        if (err.name === "AbortError") return null;
        lastError = err.message;
        this.log(`❌ 端点 ${endpoint} 异常: ${lastError}`);
      }
    }

    throw new Error(`所有上传端点都失败，最后错误: ${lastError || "未知错误"}`);
  }

  // ─── 登录流程 ─────────────────────────────────────────────────────────────────
  
  async login() {
    this.log("\n🔐 开始微信扫码登录...\n");

    try {
      this.log('正在获取登录二维码...');
      const qrResp = await this.apiGet(DEFAULT_BASE_URL, `ilink/bot/get_bot_qrcode?bot_type=${BOT_TYPE}`);
      const qrcode = qrResp.qrcode;
      const qrcodeUrl = qrResp.qrcode_img_content;

      if (!qrcode || !qrcodeUrl) {
        throw new Error('无法获取二维码信息');
      }

      this.log("📱 请用微信扫描以下二维码：\n");
      this.log(`二维码 URL: ${qrcodeUrl}`);
      this.log(`二维码标识: ${qrcode}`);
      
      // 在控制台直接显示二维码
      try {
        this.log('生成二维码...');
        const { default: qrcodeTerminal } = await import('qrcode-terminal');
        
        console.error('\n');
        qrcodeTerminal.generate(qrcodeUrl, { small: true }, (qr) => {
          console.error(qr);
        });
        console.error('\n');
        
        this.log('✅ 二维码已显示在控制台，请用微信扫描。');
      } catch (error) {
        this.log(`⚠️  无法显示二维码: ${error.message}`);
        this.log('请手动打开二维码 URL 进行扫描。');
      }

      // 轮询扫码状态
      this.log("⏳ 等待扫码...");
      const deadline = Date.now() + 5 * 60_000;
      let refreshCount = 0;
      let currentQrcode = qrcode;
      let currentQrcodeUrl = qrcodeUrl;
      let lastStatus = '';

      while (Date.now() < deadline) {
        try {
          const statusResp = await this.apiGet(
            DEFAULT_BASE_URL,
            `ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(currentQrcode)}`,
          );

          const status = statusResp.status;
          
          if (status !== lastStatus) {
            lastStatus = status;
            switch (status) {
              case "wait":
                this.log("⏳ 等待扫码...");
                break;
              case "scaned":
                this.log("👀 已扫码，请在微信端确认...");
                break;
              case "expired": {
                refreshCount++;
                if (refreshCount > 3) {
                  throw new Error(`二维码多次过期（${refreshCount}/3），请重新运行`);
                }
                this.log(`\n⏳ 二维码过期，刷新中 (${refreshCount}/3)...`);
                const newQr = await this.apiGet(DEFAULT_BASE_URL, `ilink/bot/get_bot_qrcode?bot_type=${BOT_TYPE}`);
                currentQrcode = newQr.qrcode;
                currentQrcodeUrl = newQr.qrcode_img_content;
                this.log(`  新二维码 URL: ${currentQrcodeUrl}`);
                break;
              }
              case "confirmed": {
                this.log("\n✅ 登录成功！\n");
                const tokenData = {
                  token: statusResp.bot_token,
                  baseUrl: statusResp.baseurl || DEFAULT_BASE_URL,
                  accountId: statusResp.ilink_bot_id,
                  userId: statusResp.ilink_user_id,
                  savedAt: new Date().toISOString(),
                };
                
                const tokenDir = path.dirname(TOKEN_FILE);
                if (!fs.existsSync(tokenDir)) {
                  fs.mkdirSync(tokenDir, { recursive: true });
                }
                
                fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokenData, null, 2), "utf-8");
                fs.chmodSync(TOKEN_FILE, 0o600);
                this.log(`  Bot ID : ${tokenData.accountId}`);
                this.log(`  Base URL: ${tokenData.baseUrl}`);
                this.log(`  Token 已保存到 ${TOKEN_FILE}\n`);
                this.session = tokenData;
                return true;
              }
              default:
                this.log(`⚠️  未知状态: ${status}`);
            }
          }

          await new Promise((r) => setTimeout(r, 1000));
        } catch (error) {
          this.log(`⚠️  检查扫码状态时出错: ${error.message}`);
          await new Promise((r) => setTimeout(r, 2000));
        }
      }

      throw new Error("登录超时，请重新运行");
    } catch (error) {
      this.error(`登录失败: ${error.message}\n`);
      throw error;
    }
  }

  loadSession() {
    if (fs.existsSync(TOKEN_FILE)) {
      try {
        this.session = JSON.parse(fs.readFileSync(TOKEN_FILE, "utf-8"));
        this.log(`✅ 已加载 token（Bot: ${this.session.accountId}）`);
        return true;
      } catch (error) {
        this.error(`加载 token 失败: ${error.message}`);
        return false;
      }
    }
    return false;
  }

  // ─── 消息收发 ─────────────────────────────────────────────────────────────────
  
  async sendMessage(to, text, filePath = null) {
    if (!this.session) {
      throw new Error("未登录");
    }
    
    const { token, baseUrl } = this.session;
    const clientId = `cli-${crypto.randomUUID()}`;
    
    let itemList = [];
    
    if (filePath) {
      this.log(`📎 准备发送文件: ${filePath}`);
      
      try {
        const fileStats = fs.statSync(filePath);
        const fileName = path.basename(filePath);
        
        this.log(`📤 尝试上传文件到服务器...`);
        
        try {
          const fileUrl = await this.uploadFile(filePath);
          
          if (!fileUrl) {
            throw new Error('文件上传失败，未返回文件 URL');
          }
          
          this.log(`✅ 文件上传成功: ${fileUrl}`);
          
          itemList.push({
            type: 4, // FILE
            file_item: {
              file_name: fileName,
              total_size: fileStats.size,
              file_url: fileUrl
            }
          });
          
          this.log(`📎 发送文件: ${fileName}`);
        } catch (uploadError) {
          this.log(`⚠️  文件上传失败: ${uploadError.message}`);
          this.log(`💡 提示: 微信 iLink API 可能不支持文件上传功能`);
          this.log(`💡 替代方案: 尝试发送文件链接`);
          
          itemList.push({
            type: 1, // TEXT
            text_item: { text: `[文件链接] ${filePath}` }
          });
          
          this.log(`💬 发送文件链接: ${filePath}`);
        }
      } catch (error) {
        this.error(`文件处理失败: ${error.message}`);
        throw error;
      }
    } else {
      itemList.push({
        type: 1, // TEXT
        text_item: { text }
      });
      
      this.log(`💬 发送消息: ${text}`);
    }

    await this.apiPost(
      baseUrl,
      "ilink/bot/sendmessage",
      {
        msg: {
          from_user_id: "",
          to_user_id: to,
          client_id: clientId,
          message_type: 2, // BOT
          message_state: 2, // FINISH
          item_list: itemList,
        },
      },
      token,
    );
    
    this.log(`✅ 消息已发送到 ${to}`);
    return clientId;
  }

  async getUpdates() {
    if (!this.session) {
      throw new Error("未登录");
    }
    
    const { token, baseUrl } = this.session;
    const resp = await this.apiPost(
      baseUrl,
      "ilink/bot/getupdates",
      {},
      token,
      38_000,
    );
    return resp ?? { ret: 0, msgs: [] };
  }

  extractText(msg) {
    const result = {
      text: '',
      media: [],
      hasMedia: false
    };
    
    for (const item of msg.item_list ?? []) {
      if (item.type === 1 && item.text_item?.text) {
        result.text = item.text_item.text;
      }
      else if (item.type === 3 && item.voice_item?.text) {
        result.text = `[语音] ${item.voice_item.text}`;
        result.media.push({
          type: 'voice',
          text: item.voice_item.text,
          duration: item.voice_item?.play_time
        });
        result.hasMedia = true;
      }
      else if (item.type === 2 && item.image_item) {
        result.text = '[图片]';
        
        const imageUrl = item.image_item?.image_url || item.image_item?.url;
        result.media.push({
          type: 'image',
          url: imageUrl,
          width: item.image_item?.width,
          height: item.image_item?.height,
          size: item.image_item?.total_size
        });
        result.hasMedia = true;
      }
      else if (item.type === 4 && item.file_item) {
        result.text = `[文件] ${item.file_item?.file_name ?? ""}`;
        const fileUrl = item.file_item?.file_url || item.file_item?.url;
        result.media.push({
          type: 'file',
          name: item.file_item?.file_name,
          url: fileUrl,
          size: item.file_item?.total_size
        });
        result.hasMedia = true;
      }
      else if (item.type === 5 && item.video_item) {
        result.text = '[视频]';
        const videoUrl = item.video_item?.video_url || item.video_item?.url;
        result.media.push({
          type: 'video',
          url: videoUrl,
          duration: item.video_item?.play_time,
          size: item.video_item?.total_size
        });
        result.hasMedia = true;
      }
    }
    
    if (!result.text) {
      result.text = "[空消息]";
    }
    
    return result;
  }

  // ─── 交互式界面 ────────────────────────────────────────────────────────────────
  
  async interactiveMode() {
    this.rl = createInterface({
      input: process.stdin,
      output: process.stdout
    });

    this.log('\n🎯 交互式模式已启动');
    
    this.loadSession();
    if (this.session) {
      this.log(`✅ 已登录（Bot: ${this.session.accountId}）`);
    } else {
      this.log('⚠️  未登录，请先使用 login 命令登录');
    }
    
    this.log('\n可用命令:');
    this.log('  send [用户ID] <消息>    - 发送消息（用户ID可选，默认使用最后一个发消息的用户）');
    this.log('  file [用户ID] <文件路径>  - 发送文件（用户ID可选，默认使用最后一个发消息的用户）');
    this.log('  poll                       - 轮询消息');
    this.log('  status                     - 查看状态');
    this.log('  logout                     - 退出登录');
    this.log('  quit/exit                 - 退出程序');
    this.log('  help                       - 显示帮助\n');

    this.rl.setPrompt('wechat> ');
    this.rl.prompt();

    for await (const line of this.rl) {
      const trimmed = line.trim();
      if (!trimmed) {
        this.rl.prompt();
        continue;
      }

      const parts = trimmed.split(/\s+/);
      const command = parts[0].toLowerCase();
      const args = parts.slice(1);

      try {
        switch (command) {
          case 'send':
            if (args.length < 1) {
              if (this.lastSenderId) {
                this.log('用法: send [用户ID] <消息>');
                this.log(`当前默认用户ID: ${this.lastSenderId}`);
              } else {
                this.log('用法: send <用户ID> <消息>');
                this.log('提示: 首次使用需要指定用户ID，之后可以使用默认用户ID');
              }
            } else {
              let to, text;
              if (args.length >= 2) {
                to = args[0];
                text = args.slice(1).join(' ');
              } else {
                to = this.lastSenderId;
                text = args[0];
              }
              
              if (!to) {
                this.error('未找到默认用户ID，请先轮询消息或指定用户ID');
              } else {
                await this.sendMessage(to, text);
              }
            }
            break;
          case 'file':
            if (args.length < 1) {
              if (this.lastSenderId) {
                this.log('用法: file [用户ID] <文件路径>');
                this.log(`当前默认用户ID: ${this.lastSenderId}`);
              } else {
                this.log('用法: file <用户ID> <文件路径>');
                this.log('提示: 首次使用需要指定用户ID，之后可以使用默认用户ID');
              }
            } else {
              let to, filePath;
              if (args.length >= 2) {
                to = args[0];
                filePath = args[1];
              } else {
                to = this.lastSenderId;
                filePath = args[0];
              }
              
              if (!to) {
                this.error('未找到默认用户ID，请先轮询消息或指定用户ID');
              } else {
                await this.sendMessage(to, null, filePath);
              }
            }
            break;
          case 'poll':
            await this.pollMessages();
            break;
          case 'status':
            this.showStatus();
            break;
          case 'logout':
            await this.logout();
            break;
          case 'help':
            this.log('\n可用命令:');
            this.log('  send [用户ID] <消息>    - 发送消息（用户ID可选，默认使用最后一个发消息的用户）');
            this.log('  file [用户ID] <文件路径>  - 发送文件（用户ID可选，默认使用最后一个发消息的用户）');
            this.log('  poll                       - 轮询消息');
            this.log('  status                     - 查看状态');
            this.log('  logout                     - 退出登录');
            this.log('  quit/exit                 - 退出程序');
            this.log('  help                       - 显示帮助\n');
            break;
          case 'quit':
          case 'exit':
            this.log('再见！');
            this.rl.close();
            process.exit(0);
            break;
          default:
            this.log(`未知命令: ${command}`);
            this.log('输入 "help" 查看可用命令');
        }
      } catch (error) {
        this.error(`命令执行失败: ${error.message}`);
      }

      this.rl.prompt();
    }
  }

  async pollMessages() {
    this.log('📥 轮询新消息...\n');
    
    try {
      const resp = await this.getUpdates();
      const msgs = resp.msgs ?? [];
      
      if (msgs.length === 0) {
        this.log('没有新消息');
        return;
      }

      for (const msg of msgs) {
        if (msg.message_type !== 1) continue;

        const from = msg.from_user_id;
        const chatId = msg.chat_id || from;
        const extracted = this.extractText(msg);
        
        this.lastSenderId = from;
        
        this.log(`\n📩 新消息:`);
        this.log(`  来自: ${from}`);
        this.log(`  聊天ID: ${chatId}`);
        this.log(`  内容: ${extracted.text}`);
        
        if (extracted.hasMedia) {
          this.log(`  媒体:`);
          for (const media of extracted.media) {
            this.log(`    - ${media.type}: ${media.url || media.name || media.text}`);
          }
        }
        this.log('');
      }
    } catch (error) {
      this.error(`轮询消息失败: ${error.message}`);
    }
  }

  showStatus() {
    this.log('\n📊 状态信息:');
    if (this.session) {
      this.log(`  登录状态: ✅ 已登录`);
      this.log(`  Bot ID: ${this.session.accountId}`);
      this.log(`  用户 ID: ${this.session.userId}`);
      this.log(`  Base URL: ${this.session.baseUrl}`);
      this.log(`  Token 保存时间: ${this.session.savedAt}`);
    } else {
      this.log(`  登录状态: ❌ 未登录`);
    }
    this.log('');
  }

  async logout() {
    this.log('🚪 退出登录...');
    
    if (fs.existsSync(TOKEN_FILE)) {
      fs.unlinkSync(TOKEN_FILE);
      this.log('✅ Token 已删除');
    }
    
    this.session = null;
    this.log('✅ 已退出登录\n');
  }

  // ─── 命令行参数处理 ────────────────────────────────────────────────────────
  
  printHelp() {
    console.log(`
WeChat iLink CLI - 独立的微信命令行工具

用法:
  node wechat-cli.js [命令] [参数]

命令:
  login                      - 扫码登录微信
  send [用户ID] <消息>      - 发送消息（用户ID可选，默认使用最后一个发消息的用户）
  file [用户ID] <文件路径>    - 发送文件（用户ID可选，默认使用最后一个发消息的用户）
  poll                       - 轮询新消息
  status                     - 查看登录状态
  logout                     - 退出登录
  interactive                 - 进入交互式模式
  help                       - 显示此帮助信息

示例:
  node wechat-cli.js login
  node wechat-cli.js send user123 "你好"
  node wechat-cli.js send "你好"                    # 使用默认用户ID
  node wechat-cli.js file user123 "./document.pdf"
  node wechat-cli.js file "./document.pdf"           # 使用默认用户ID
  node wechat-cli.js poll
  node wechat-cli.js status
  node wechat-cli.js logout
  node wechat-cli.js interactive

配置:
  Token 文件: ${TOKEN_FILE}
  主目录: ${HOME_DIR}
`);
  }

  async runCommand(args) {
    const command = args[0]?.toLowerCase();
    const params = args.slice(1);
    let to;

    try {
      switch (command) {
        case 'login':
          await this.login();
          break;
        case 'send':
          if (params.length < 1) {
            this.error('用法: send [用户ID] <消息>');
            this.error('提示: 首次使用需要指定用户ID，之后可以使用默认用户ID');
            process.exit(1);
          }
          let text;
          if (params.length >= 2) {
            to = params[0];
            text = params.slice(1).join(' ');
          } else {
            to = this.lastSenderId;
            text = params[0];
          }
          
          if (!to) {
            this.error('未找到默认用户ID，请先轮询消息或指定用户ID');
            process.exit(1);
          }
          await this.sendMessage(to, text);
          break;
        case 'file':
          if (params.length < 1) {
            this.error('用法: file [用户ID] <文件路径>');
            this.error('提示: 首次使用需要指定用户ID，之后可以使用默认用户ID');
            process.exit(1);
          }
          let filePath;
          if (params.length >= 2) {
            to = params[0];
            filePath = params[1];
          } else {
            to = this.lastSenderId;
            filePath = params[0];
          }
          
          if (!to) {
            this.error('未找到默认用户ID，请先轮询消息或指定用户ID');
            process.exit(1);
          }
          await this.sendMessage(to, null, filePath);
          break;
        case 'poll':
          await this.pollMessages();
          break;
        case 'status':
          this.showStatus();
          break;
        case 'logout':
          await this.logout();
          break;
        case 'interactive':
          await this.interactiveMode();
          break;
        case 'help':
        case '--help':
        case '-h':
          this.printHelp();
          break;
        default:
          if (!command) {
            this.printHelp();
          } else {
            this.error(`未知命令: ${command}`);
            this.log('使用 "help" 查看可用命令');
            process.exit(1);
          }
      }
    } catch (error) {
      this.error(`命令执行失败: ${error.message}`);
      process.exit(1);
    }
  }
}

// ─── 主程序 ─────────────────────────────────────────────────────────────────────

const cli = new WeChatCLI();
const args = process.argv.slice(2);

if (args.length === 0) {
  cli.printHelp();
} else {
  cli.runCommand(args);
}