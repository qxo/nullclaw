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
      groupPolicy: 'allowlist'
    };
    this.messageIdCounter = 0;
    this.seenMessageIds = new Set();
    this.isRunning = false;
    this.pollingInterval = null;
    this.getUpdatesBuf = "";
    
    // Set up signal handlers
    process.on('SIGINT', () => this.signalHandler());
    process.on('SIGTERM', () => this.signalHandler());
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

    // 1. 获取二维码
    const qrResp = await this.apiGet(DEFAULT_BASE_URL, `ilink/bot/get_bot_qrcode?bot_type=${BOT_TYPE}`);
    const qrcode = qrResp.qrcode;
    const qrcodeUrl = qrResp.qrcode_img_content;

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

    while (Date.now() < deadline) {
      const statusResp = await this.apiGet(
        DEFAULT_BASE_URL,
        `ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(currentQrcode)}`,
      );

      switch (statusResp.status) {
        case "wait":
          process.stdout.write(".");
          break;
        case "scaned":
          process.stdout.write("\n👀 已扫码，请在微信端确认...\n");
          break;
        case "expired": {
          refreshCount++;
          if (refreshCount > 3) {
            throw new Error("二维码多次过期，请重新运行");
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
      }

      await new Promise((r) => setTimeout(r, 1000));
    }

    throw new Error("登录超时");
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
  
  /** 从消息 item_list 提取纯文本 */
  extractText(msg) {
    for (const item of msg.item_list ?? []) {
      if (item.type === 1 && item.text_item?.text) return item.text_item.text;
      if (item.type === 3 && item.voice_item?.text) return `[语音] ${item.voice_item.text}`;
      if (item.type === 2) return "[图片]";
      if (item.type === 4) return `[文件] ${item.file_item?.file_name ?? ""}`;
      if (item.type === 5) return "[视频]";
    }
    return "[空消息]";
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

        const msgId = msg.client_id || `msg_${this.messageIdCounter++}`;
        const from = msg.from_user_id;
        const text = this.extractText(msg);
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

        this.log(`📩 收到消息: ${text}`);

        // Send inbound_message notification to nullclaw via stdout
        const notification = {
          jsonrpc: '2.0',
          method: 'inbound_message',
          params: {
            message: {
              sender_id: from,
              chat_id: from,
              text: text,
              media: [],
              metadata: { context_token: contextToken }
            }
          }
        };

        process.stdout.write(JSON.stringify(notification) + '\n');
        this.log(`Sent inbound_message notification for message ${msgId} from ${from}`);
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
  
  async start() {
    this.log('Received start request');
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