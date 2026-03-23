#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── 配置 ────────────────────────────────────────────────────────────────────

const DEFAULT_BASE_URL = "https://ilinkai.weixin.qq.com";
const BOT_TYPE = "3";

// 获取用户主目录
const HOME_DIR = process.env.HOME || process.env.USERPROFILE;
const TOKEN_FILE = path.join(HOME_DIR, '.nullclaw', '.weixin-token.json');
const CHANNEL_VERSION = "1.0.2";

class WeChatPlugin {
  constructor() {
    this.session = null;
    this.config = {
      allowFrom: ['*'],
      groupPolicy: 'allowlist',
      enableMedia: true,
      enableVoice: true,
      enableVideo: true,
      enableFile: true,
      autoReply: {
        enabled: true,
        message: '感谢您的消息，我会尽快回复。'
      },
      messageFilter: {
        enabled: false,
        keywords: [],
        mode: 'block' // 'block' or 'allow'
      },
      pollingInterval: 1000, // 消息轮询间隔（毫秒）
      maxRetries: 3, // 最大重试次数
      timeoutMs: 30000, // 请求超时时间（毫秒）
      saveMessages: true, // 是否保存消息到本地
      messageDir: path.join(HOME_DIR, '.nullclaw', 'workspace', 'wechat') // 消息保存目录
    };
    
    // 处理配置中的相对路径
    this._processConfigPaths();
    this.messageIdCounter = 0;
    this.seenMessageIds = new Set();
    this.isRunning = false;
    this.pollingInterval = null;
    this.getUpdatesBuf = "";
    
    // Set up signal handlers
    process.on('SIGINT', () => this.signalHandler());
    process.on('SIGTERM', () => this.signalHandler());
  }
  
  _processConfigPaths() {
    if (this.config.messageDir && this.config.messageDir.startsWith('~/')) {
      this.config.messageDir = path.join(HOME_DIR, this.config.messageDir.substring(2));
    }
  }
  
  _mergeConfig(userConfig) {
    if (!userConfig) return;
    
    const configMapping = {
      'allow_from': 'allowFrom',
      'group_policy': 'groupPolicy',
      'enable_media': 'enableMedia',
      'enable_voice': 'enableVoice',
      'enable_video': 'enableVideo',
      'enable_file': 'enableFile',
      'auto_reply': 'autoReply',
      'message_filter': 'messageFilter',
      'polling_interval': 'pollingInterval',
      'max_retries': 'maxRetries',
      'timeout_ms': 'timeoutMs',
      'save_messages': 'saveMessages',
      'message_dir': 'messageDir'
    };
    
    for (const [userKey, internalKey] of Object.entries(configMapping)) {
      if (userConfig[userKey] !== undefined) {
        const userValue = userConfig[userKey];
        const internalValue = this.config[internalKey];
        
        if (typeof userValue === 'object' && !Array.isArray(userValue) && userValue !== null) {
          if (typeof internalValue === 'object' && !Array.isArray(internalValue) && internalValue !== null) {
            this.config[internalKey] = { ...internalValue, ...userValue };
          } else {
            this.config[internalKey] = { ...userValue };
          }
        } else {
          this.config[internalKey] = userValue;
        }
      }
    }
    
    this._processConfigPaths();
    this.log(`Configuration merged successfully`);
  }
  
  log(message) {
    console.error(`[wechat-plugin] ${message}`);
  }
  
  signalHandler() {
    this.log('Received termination signal, cleaning up...');
    this.stopMessagePolling();
    this.isRunning = false;
    process.exit(0);
  }
  
  startMessagePolling() {
    if (this.pollingInterval) {
      return;
    }
    
    this.log('Starting message polling loop...');
    
    const poll = async () => {
      if (!this.isRunning || !this.session) {
        return;
      }
      
      try {
        await this.pollMessages();
      } catch (error) {
        this.log(`Message polling error: ${error.message}`);
      }
    };
    
    // Start polling immediately, then every 1 second
    poll();
    this.pollingInterval = setInterval(poll, 1000);
  }
  
  stopMessagePolling() {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
      this.log('Message polling loop stopped');
    }
  }
  
  // ─── HTTP 工具 ────────────────────────────────────────────────────────────────
  
  /** X-WECHAT-UIN: 随机 uint32 → 十进制字符串 → base64 */
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
    this.log(`GET 请求: ${url}`);
    try {
      const res = await fetch(url);
      const text = await res.text();
      this.log(`响应状态: ${res.status}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${text}`);
      return JSON.parse(text);
    } catch (error) {
      this.log(`GET 请求失败: ${error.message}`);
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
      if (err.name === "AbortError") return null; // 长轮询超时，正常
      throw err;
    }
  }
  
  // ─── 登录流程 ─────────────────────────────────────────────────────────────────
  
  async login() {
    this.log("\n🔐 开始微信扫码登录...\n");

    try {
      // 1. 获取二维码
      this.log('正在获取登录二维码...');
      const qrResp = await this.apiGet(DEFAULT_BASE_URL, `ilink/bot/get_bot_qrcode?bot_type=${BOT_TYPE}`);
      const qrcode = qrResp.qrcode;
      const qrcodeUrl = qrResp.qrcode_img_content;

      if (!qrcode || !qrcodeUrl) {
        throw new Error('无法获取二维码信息');
      }

      this.log("📱 请用微信扫描以下二维码：\n");

      // 显示二维码 URL
      this.log(`二维码 URL: ${qrcodeUrl}`);
      this.log(`二维码标识: ${qrcode}`);
      
      // 在控制台直接显示二维码
      try {
        this.log('生成二维码...');
        const { default: qrcodeTerminal } = await import('qrcode-terminal');
        
        // 在控制台显示二维码（ASCII art）
        console.error('\n');
        qrcodeTerminal.generate(qrcodeUrl, { small: true }, (qr) => {
          console.error(qr);
        });
        console.error('\n');
        
        this.log('✅ 二维码已显示在控制台，请用微信扫描。');
        this.log(`二维码 URL: ${qrcodeUrl}`);
        this.log(`二维码标识: ${qrcode}`);
      } catch (error) {
        this.log(`⚠️  无法显示二维码: ${error.message}`);
        this.log(`错误堆栈: ${error.stack}`);
        this.log('请手动打开二维码 URL 进行扫描。');
      }

      // 2. 轮询扫码状态
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
          
          // 避免重复输出相同状态
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
                if (refreshCount > this.config.maxRetries) {
                  throw new Error(`二维码多次过期（${refreshCount}/${this.config.maxRetries}），请重新运行`);
                }
                this.log(`\n⏳ 二维码过期，刷新中 (${refreshCount}/${this.config.maxRetries})...`);
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
                
                // 确保目录存在
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
          await new Promise((r) => setTimeout(r, 2000)); // 错误后等待更长时间
        }
      }

      throw new Error("登录超时，请重新运行");
    } catch (error) {
      this.log(`\n❌ 登录失败: ${error.message}\n`);
      this.log('请检查：');
      this.log('1. 网络连接是否正常');
      this.log('2. 微信账号状态是否正常');
      this.log('3. 是否有防火墙或代理限制');
      this.log('4. 如问题持续，请删除 token 文件后重试\n');
      throw error;
    }
  }
  
  // ─── 消息收发 ─────────────────────────────────────────────────────────────────
  
  /** 长轮询获取新消息，返回 { msgs, get_updates_buf } */
  async getUpdates() {
    if (!this.session) {
      throw new Error("未登录");
    }
    
    const { token, baseUrl } = this.session;
    const resp = await this.apiPost(
      baseUrl,
      "ilink/bot/getupdates",
      { get_updates_buf: this.getUpdatesBuf ?? "" },
      token,
      38_000, // 长轮询，服务器最多 hold 35s
    );
    return resp ?? { ret: 0, msgs: [], get_updates_buf: this.getUpdatesBuf };
  }
  
  /** 发送文本消息 */
  async sendMessage(to, text, contextToken) {
    if (!this.session) {
      throw new Error("未登录");
    }
    
    const { token, baseUrl } = this.session;
    const clientId = `nullclaw-${crypto.randomUUID()}`;
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
          context_token: contextToken,
          item_list: [
            { type: 1, text_item: { text } }, // TEXT
          ],
        },
      },
      token,
    );
    return clientId;
  }
  
  /** 从消息 item_list 提取消息内容和媒体信息 */
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
        result.media.push({
          type: 'image',
          url: item.image_item?.image_url,
          width: item.image_item?.width,
          height: item.image_item?.height,
          size: item.image_item?.total_size
        });
        result.hasMedia = true;
      }
      else if (item.type === 4 && item.file_item) {
        result.text = `[文件] ${item.file_item?.file_name ?? ""}`;
        result.media.push({
          type: 'file',
          name: item.file_item?.file_name,
          url: item.file_item?.file_url,
          size: item.file_item?.total_size
        });
        result.hasMedia = true;
      }
      else if (item.type === 5 && item.video_item) {
        result.text = '[视频]';
        result.media.push({
          type: 'video',
          url: item.video_item?.video_url,
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
  
  async pollMessages() {
    if (!this.session) {
      this.log('未登录，跳过消息轮询');
      return;
    }
    
    try {
      const resp = await this.getUpdates();

      // 更新 buf（服务器下发的游标，下次请求带上）
      if (resp.get_updates_buf) {
        this.getUpdatesBuf = resp.get_updates_buf;
      }

      for (const msg of resp.msgs ?? []) {
        // 只处理用户发来的消息（message_type=1）
        if (msg.message_type !== 1) continue;

        const currentMsgId = this.messageIdCounter++;
        const msgId = msg.client_id || `msg_${currentMsgId}`;
        const from = msg.from_user_id;
        const chatId = msg.chat_id || from; // 支持群组消息
        const extracted = this.extractText(msg);
        const text = extracted.text;
        const media = extracted.media;
        const contextToken = msg.context_token;

        if (this.seenMessageIds.has(msgId)) {
          continue;
        }
        this.seenMessageIds.add(msgId);

        // Limit seen messages to avoid memory issues
        if (this.seenMessageIds.size > 1000) {
          const oldestId = this.seenMessageIds.values().next().value;
          this.seenMessageIds.delete(oldestId);
        }

        // Check allowlist
        if (!this._isAllowed(from)) {
          this.log(`Message from ${from} blocked by allowlist`);
          continue;
        }

        // 检查是否为群组消息
        const isGroup = chatId !== from;
        if (isGroup && this.config.groupPolicy === 'allowlist' && !this._isAllowed(from)) {
          this.log(`Group message from ${from} blocked by group policy`);
          continue;
        }

        // 消息过滤
        if (this.config.messageFilter.enabled) {
          const shouldFilter = this._shouldFilterMessage(text);
          if ((this.config.messageFilter.mode === 'block' && shouldFilter) ||
              (this.config.messageFilter.mode === 'allow' && !shouldFilter)) {
            this.log(`Message from ${from} filtered by message filter`);
            continue;
          }
        }

        this.log(`📩 收到消息: ${text}${isGroup ? ' (群组)' : ''}`);

        // Send inbound_message notification to nullclaw via stdout
        const notification = {
          jsonrpc: '2.0',
          method: 'inbound_message',
          params: {
            message: {
              sender_id: from,
              chat_id: chatId,
              text: text,
              media: media,
              metadata: { 
                context_token: contextToken,
                is_group: isGroup,
                has_media: extracted.hasMedia
              }
            }
          }
        };

        process.stdout.write(JSON.stringify(notification) + '\n');
        this.log(`Sent inbound_message notification for message ${msgId} from ${from}`);

        // 保存消息到本地
        const savedPath = await this._saveMessage(msg, extracted, isGroup, currentMsgId);
        if (savedPath) {
          this.log(`Message saved at: ${savedPath}`);
        }

        // 自动回复
        if (this.config.autoReply.enabled && !isGroup) {
          await this._sendAutoReply(chatId, text);
        }
      }
    } catch (err) {
      if (err.message?.includes("session timeout") || err.message?.includes("-14")) {
        this.log("❌ Session 已过期，需要重新登录");
        await this.login();
      } else {
        this.log(`消息轮询错误: ${err.message}`);
      }
    }
  }
  
  async sendMessageWrapper(to, text) {
    if (!this.session) {
      this.log('未登录，无法发送消息');
      return false;
    }
    
    try {
      this.log(`Sending message to ${to}: ${text}`);
      await this.sendMessage(to, text);
      this.log(`Message sent successfully to ${to}`);
      return true;
    } catch (error) {
      this.log(`Failed to send message: ${error.message}`);
      return false;
    }
  }
  
  _isAllowed(sender) {
    if (!Array.isArray(this.config.allowFrom)) {
      return true;
    }
    
    if (this.config.allowFrom.includes('*')) {
      return true;
    }
    
    return this.config.allowFrom.includes(sender);
  }
  
  _shouldFilterMessage(text) {
    if (!this.config.messageFilter.keywords || this.config.messageFilter.keywords.length === 0) {
      return false;
    }
    
    const lowerText = text.toLowerCase();
    return this.config.messageFilter.keywords.some(keyword => 
      lowerText.includes(keyword.toLowerCase())
    );
  }
  
  async _sendAutoReply(to, originalText) {
    try {
      this.log(`Sending auto reply to ${to}`);
      await this.sendMessage(to, this.config.autoReply.message);
      this.log(`Auto reply sent successfully to ${to}`);
    } catch (error) {
      this.log(`Failed to send auto reply: ${error.message}`);
    }
  }
  
  async _saveMessage(msg, extracted, isGroup, msgId) {
    if (!this.config.saveMessages) {
      return null;
    }
    
    try {
      const timestamp = new Date().toISOString();
      const date = timestamp.split('T')[0];
      const time = timestamp.split('T')[1].split('.')[0];
      
      const messageData = {
        id: msg.client_id || `msg_${msgId}`,
        timestamp: timestamp,
        date: date,
        time: time,
        from: msg.from_user_id,
        chat_id: msg.chat_id || msg.from_user_id,
        is_group: isGroup,
        text: extracted.text,
        media: extracted.media,
        has_media: extracted.hasMedia,
        context_token: msg.context_token
      };
      
      const filename = `msg_${msg.client_id || msgId}.json`;
      const filepath = path.join(this.config.messageDir, date, filename);
      
      const dir = path.dirname(filepath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      fs.writeFileSync(filepath, JSON.stringify(messageData, null, 2), 'utf-8');
      this.log(`Message saved to: ${filepath}`);
      
      // 返回相对路径以减少 token 数量
      const relativePath = path.join('wechat', date, filename);
      return relativePath;
    } catch (error) {
      this.log(`Failed to save message: ${error.message}`);
      return null;
    }
  }
  
  async healthCheck() {
    if (!this.session) {
      return { healthy: false, status: 'not_logged_in' };
    }
    
    try {
      // 尝试发送一个空的 getUpdates 请求来检查会话是否有效
      await this.getUpdates();
      return { healthy: true, status: 'connected' };
    } catch (error) {
      return { healthy: false, status: 'error' };
    }
  }
  
  async start(params) {
    this.log('Received start request');
    
    // 处理配置参数
    if (params && params.config) {
      this._mergeConfig(params.config);
    }
    
    // 立即返回成功响应
    this.isRunning = true;
    
    // 启动消息轮询循环
    this.startMessagePolling();
    
    // 在后台处理登录流程
    setTimeout(async () => {
      try {
        // 加载或获取 token
        if (fs.existsSync(TOKEN_FILE)) {
          this.session = JSON.parse(fs.readFileSync(TOKEN_FILE, "utf-8"));
          this.log(`✅ 已加载 token（Bot: ${this.session.accountId}，保存于 ${this.session.savedAt}`);
          this.log(`   如需重新登录，删除 ${TOKEN_FILE} 后重启插件`);
        } else {
          this.log('No token file found, starting login process...');
          await this.login();
        }
      } catch (error) {
        this.log(`登录失败: ${error.message}`);
      }
    }, 1000);
    
    const response = { result: { started: true } };
    this.log(`Sending start response: ${JSON.stringify(response)}`);
    return response;
  }
  
  async stop() {
    this.stopMessagePolling();
    this.isRunning = false;
    return { result: { stopped: true } };
  }
  
  async send(to, text) {
    return { result: { sent: await this.sendMessageWrapper(to, text) } };
  }
  
  async health() {
    return { result: await this.healthCheck() };
  }
  
  get_manifest() {
    const result = {
      protocol_version: 2,
      name: 'wechat_ilink',
      version: '1.0.0',
      capabilities: {
        health: true,
        streaming: false,
        send_rich: false,
        typing: false,
        edit: false,
        delete: false,
        reactions: false,
        read_receipts: false
      }
    };
    this.log(`get_manifest result: ${JSON.stringify(result)}`);
    return { result };
  }
  
  async handleRequest(request) {
    const { method, params, id, jsonrpc } = request;
    
    if (method === 'get_manifest') {
      return {
        jsonrpc: jsonrpc || '2.0',
        id: id,
        ...this.get_manifest()
      };
    }
    
    else if (method === 'start') {
      return {
        jsonrpc: jsonrpc || '2.0',
        id: id,
        ...(await this.start())
      };
    }
    
    else if (method === 'stop') {
      return {
        jsonrpc: jsonrpc || '2.0',
        id: id,
        ...(await this.stop())
      };
    }
    
    else if (method === 'send') {
      const { to, text } = params;
      return {
        jsonrpc: jsonrpc || '2.0',
        id: id,
        ...(await this.send(to, text))
      };
    }
    
    else if (method === 'health') {
      return {
        jsonrpc: jsonrpc || '2.0',
        id: id,
        ...(await this.health())
      };
    }
    
    else {
      return {
        jsonrpc: jsonrpc || '2.0',
        id: id,
        error: {
          code: -32601,
          message: `Method not found: ${method}`
        }
      };
    }
  }
  
  run() {
    // Read JSON-RPC requests from stdin
    process.stdin.on('data', async (data) => {
      const input = data.toString().trim();
      if (!input) return;
      
      try {
        this.log(`Received request: ${input}`);
        const request = JSON.parse(input);
        const response = await this.handleRequest(request);
        
        // Send response to stdout
        if (response) {
          const output = JSON.stringify(response);
          process.stdout.write(output + '\n');
        }
      } catch (error) {
        this.log(`Error handling request: ${error.message}`);
        const errorResponse = {
          error: {
            code: -32700,
            message: 'Parse error'
          }
        };
        const output = JSON.stringify(errorResponse);
        process.stdout.write(output + '\n');
      }
    });
    
    // Handle stdin end
    process.stdin.on('end', () => {
      this.log('stdin closed, exiting...');
      this.signalHandler();
    });
    
    this.log('WeChat plugin started, waiting for requests...');
  }
}

// Run the plugin
const plugin = new WeChatPlugin();
plugin.run();