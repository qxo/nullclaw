#!/usr/bin/env node
/**
 * NullClaw WeChat iLink Plugin (Node.js version)
 *
 * This plugin adapts to nullclaw ExternalChannel JSON-RPC/stdio protocol
 * to WeChat iLink functionality.
 */

const { spawn } = require('child_process');
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

class WeChatPlugin {
  constructor() {
    this.bridgeProcess = null;
    this.stateDir = null;
    this.config = {
      bridgeCommand: 'npx mcp-wechat-server',
      allowFrom: ['*'],
      groupPolicy: 'allowlist'
    };
    this.messageIdCounter = 0;
    this.seenMessageIds = new Set();
    this.isRunning = false;
    
    // Set up signal handlers
    process.on('SIGINT', () => this.signalHandler());
    process.on('SIGTERM', () => this.signalHandler());
  }
  
  signalHandler() {
    this.log('Received termination signal, cleaning up...');
    this.stopBridge();
    process.exit(0);
  }
  
  startBridge() {
    if (this.bridgeProcess && this.bridgeProcess.exitCode === null) {
      return true;
    }
    
    try {
      const cmdParts = this.config.bridgeCommand.split(' ');
      let cmd = cmdParts[0];
      const args = cmdParts.slice(1);
      
      // On Windows, npx is npx.cmd
      if (process.platform === 'win32' && cmd === 'npx') {
        cmd = 'npx.cmd';
      }
      
      this.log(`Starting bridge: ${cmd} ${args.join(' ')}`);
      
      this.bridgeProcess = spawn(cmd, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: this.config.bridgeDir || process.cwd(),
        shell: process.platform === 'win32' // Use shell on Windows
      });
      
      this.bridgeProcess.stdout.setEncoding('utf8');
      this.bridgeProcess.stderr.setEncoding('utf8');
      
      // Forward bridge stderr to our stderr
      this.bridgeProcess.stderr.on('data', (data) => {
        const message = data.toString().trim();
        process.stderr.write(`[wechat-bridge] ${message}\n`);
        
        // Auto-trigger login when bridge reports not logged in
        if (message.includes('Not logged in. Call login_qrcode to start.')) {
          // Check if already logged in by calling get_account
          setTimeout(async () => {
            try {
              const accountResult = await this.mcpRequest('get_account', {});
              if (accountResult && (accountResult.botToken || accountResult.text)) {
                this.log('Already logged in, skipping auto-login.');
              } else {
                this.log('Not logged in, starting login process...');
                await this.login();
              }
            } catch (error) {
              this.log(`Failed to check login status: ${error.message}`);
            }
          }, 2000);
        } else if (message.includes('Logged in as bot')) {
          this.log('Bridge already logged in.');
        }
      });
      
      // Handle bridge process exit
      this.bridgeProcess.on('exit', (code, signal) => {
        this.log(`Bridge process exited with code ${code} (signal: ${signal})`);
        this.bridgeProcess = null;
      });
      
      // Handle bridge process errors
      this.bridgeProcess.on('error', (error) => {
        this.log(`Bridge process error: ${error.message}`);
        this.bridgeProcess = null;
      });
      
      // Return immediately without waiting
      this.log('Bridge process starting...');
      return true;
      
    } catch (error) {
      this.log(`Failed to start bridge: ${error.message}`);
      return false;
    }
  }
  
  stopBridge() {
    if (this.bridgeProcess && this.bridgeProcess.exitCode === null) {
      try {
        this.bridgeProcess.kill('SIGTERM');
        this.log('Bridge stopped');
      } catch (error) {
        this.log(`Error stopping bridge: ${error.message}`);
        try {
          this.bridgeProcess.kill('SIGKILL');
          this.log('Bridge killed');
        } catch (killError) {
          // Ignore
        }
      }
    }
    this.bridgeProcess = null;
  }
  
  async mcpRequest(method, params) {
    if (!this.bridgeProcess || this.bridgeProcess.exitCode !== null) {
      const started = await this.startBridge();
      if (!started) {
        return null;
      }
    }
    
    return new Promise((resolve) => {
      // MCP protocol tools/call format
      const request = {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: method,
          arguments: params || {}
        }
      };
      
      const requestStr = JSON.stringify(request) + '\n';
      
      // Send request
      try {
        this.bridgeProcess.stdin.write(requestStr);
      } catch (error) {
        this.log(`Error writing to bridge stdin: ${error.message}`);
        this.stopBridge();
        resolve(null);
        return;
      }
      
      // Set up timeout
      const timeoutId = setTimeout(() => {
        this.log('Bridge response timeout');
        resolve(null);
      }, 30000);
      
      // Read response
      const onData = (data) => {
        clearTimeout(timeoutId);
        
        try {
          const lines = data.split('\n');
          for (const line of lines) {
            if (!line.trim()) continue;
            
            const response = JSON.parse(line);
            
            if (response.error) {
              this.log(`MCP error: ${JSON.stringify(response.error)}`);
              resolve(null);
            } else if (response.result && response.result.content && Array.isArray(response.result.content)) {
              // Handle MCP protocol response with tools/call format
              for (const item of response.result.content) {
                if (item.type === 'text' && item.text) {
                  try {
                    // Try to parse the text as JSON (most MCP responses are JSON strings)
                    const parsedContent = JSON.parse(item.text);
                    resolve(parsedContent);
                  } catch (parseError) {
                    // If not JSON, return the text as is
                    resolve({ text: item.text });
                  }
                  this.bridgeProcess.stdout.off('data', onData);
                  return;
                }
              }
              resolve(null);
            } else if (response.result) {
              // Handle JSON-RPC response as fallback
              resolve(response.result);
            } else {
              // Unknown response format
              resolve(null);
            }
            
            this.bridgeProcess.stdout.off('data', onData);
            return;
          }
        } catch (error) {
          this.log(`Response parse error: ${error.message}`);
          resolve(null);
          this.bridgeProcess.stdout.off('data', onData);
        }
      };
      
      this.bridgeProcess.stdout.on('data', onData);
    });
  }
  
  // Download QR code image from URL
  async downloadQrCode(url, outputPath) {
    return new Promise((resolve, reject) => {
      const client = url.startsWith('https') ? https : http;
      
      const request = client.get(url, (response) => {
        if (response.statusCode !== 200) {
          reject(new Error(`Failed to download: ${response.statusCode}`));
          return;
        }
        
        const file = fs.createWriteStream(outputPath);
        response.pipe(file);
        
        file.on('finish', () => {
          file.close();
          resolve(outputPath);
        });
        
        file.on('error', (err) => {
          fs.unlink(outputPath, () => {});
          reject(err);
        });
      });
      
      request.on('error', (err) => {
        reject(err);
      });
      
      request.setTimeout(30000, () => {
        request.destroy();
        reject(new Error('Download timeout'));
      });
    });
  }
  
  // Open image with system default viewer
  async openImage(imagePath) {
    return new Promise((resolve, reject) => {
      const platform = process.platform;
      let command;
      let args;
      
      if (platform === 'darwin') {
        // macOS
        command = 'open';
        args = [imagePath];
      } else if (platform === 'win32') {
        // Windows
        command = 'cmd';
        args = ['/c', 'start', '', imagePath];
      } else {
        // Linux
        command = 'xdg-open';
        args = [imagePath];
      }
      
      const child = spawn(command, args, {
        detached: true,
        stdio: 'ignore'
      });
      
      child.on('error', (err) => {
        reject(err);
      });
      
      child.on('spawn', () => {
        resolve();
      });
      
      // Unref so it doesn't block process exit
      child.unref();
    });
  }
  
  async login() {
    this.log('Starting WeChat login process...');
    
    const qrResult = await this.mcpRequest('login_qrcode', {});
    
    let qrCodeText = '';
    let qrImagePath = '';
    let qrCodeUrl = '';
    
    // Handle different response formats
    if (qrResult && qrResult.text) {
      // Response is plain text, extract info from it
      qrCodeText = qrResult.text;
      this.log('============================================');
      this.log('WeChat Login QR Code:');
      this.log(qrCodeText);
      this.log('============================================');
      
      // Extract image path from text
      const imagePathMatch = qrCodeText.match(/image at: ([^\s]+)/);
      if (imagePathMatch) {
        qrImagePath = imagePathMatch[1];
      }
      
      // Extract URL from text
      const urlMatch = qrCodeText.match(/(https?:\/\/[^\s]+)/);
      if (urlMatch) {
        qrCodeUrl = urlMatch[1];
      }
    } else if (qrResult && qrResult.qr_code_url) {
      // Response is JSON with qr_code_url
      qrCodeUrl = qrResult.qr_code_url;
    } else {
      this.log('Failed to get login QR code');
      return false;
    }
    
    // Try to open the QR code image
    let imageOpened = false;
    if (qrImagePath && fs.existsSync(qrImagePath)) {
      try {
        this.log(`Opening QR code image: ${qrImagePath}`);
        await this.openImage(qrImagePath);
        imageOpened = true;
        this.log('✅ QR code image opened. Please scan with WeChat.');
      } catch (error) {
        this.log(`⚠️ Could not open QR code image: ${error.message}`);
      }
    } else if (qrCodeUrl) {
      // Try to download and open from URL
      try {
        const tempDir = path.join(os.tmpdir(), 'nullclaw-wechat');
        if (!fs.existsSync(tempDir)) {
          fs.mkdirSync(tempDir, { recursive: true });
        }
        
        qrImagePath = path.join(tempDir, `wechat-qr-${Date.now()}.png`);
        
        this.log('Downloading QR code image...');
        await this.downloadQrCode(qrCodeUrl, qrImagePath);
        this.log(`QR code saved to: ${qrImagePath}`);
        
        this.log('Opening QR code image...');
        await this.openImage(qrImagePath);
        imageOpened = true;
        
        this.log('✅ QR code image opened. Please scan with WeChat.');
      } catch (error) {
        this.log(`⚠️ Could not download/open QR code image: ${error.message}`);
      }
    }
    
    if (!imageOpened) {
      this.log('Please scan the QR code using the information above.');
    }
    
    this.log('Waiting for QR code scan...');
    
    for (let i = 0; i < 60; i++) {
      const statusResult = await this.mcpRequest('check_qrcode_status', {});
      if (statusResult) {
        // Handle different response formats
        let status = statusResult.status;
        if (!status && statusResult.text) {
          // Parse status from text response
          const statusMatch = statusResult.text.match(/"status"\s*:\s*"([^"]+)"/);
          if (statusMatch) {
            status = statusMatch[1];
          }
        }
        
        if (status === 'confirmed') {
          this.log('============================================');
          this.log('✅ Login confirmed!');
          this.log('============================================');
          return true;
        } else if (status === 'scanned') {
          this.log('✅ QR code scanned, waiting for confirmation...');
        } else if (status === 'expired') {
          this.log('❌ QR code expired, generating new one...');
          return this.login();
        } else if (status === 'already_logged_in') {
          this.log('============================================');
          this.log('✅ Already logged in!');
          this.log('============================================');
          return true;
        }
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    this.log('❌ Login timeout');
    return false;
  }
  
  getManifest() {
    return {
      protocol_version: 2,
      capabilities: {
        health: true,
        streaming: false,
        send_rich: false,
        typing: true,
        edit: false,
        delete: false,
        reactions: false,
        read_receipts: false
      }
    };
  }
  
  async healthCheck() {
    if (!this.bridgeProcess || this.bridgeProcess.exitCode !== null) {
      const started = await this.startBridge();
      if (!started) {
        return { healthy: false, status: 'bridge_not_running' };
      }
    }
    
    const accountResult = await this.mcpRequest('get_account', {});
    
    // Handle different response formats
    let isLoggedIn = false;
    if (accountResult) {
      // Check for JSON format with botToken
      if (accountResult.botToken) {
        isLoggedIn = true;
      }
      // Check for text response (e.g., "Already logged in.")
      else if (accountResult.text && (accountResult.text.includes('logged in') || accountResult.text.includes('Already logged'))) {
        isLoggedIn = true;
      }
      // Try to parse status from text response
      else if (accountResult.text) {
        const statusMatch = accountResult.text.match(/"status"\s*:\s*"([^"]+)"/);
        if (statusMatch && statusMatch[1] === 'confirmed') {
          isLoggedIn = true;
        }
      }
    }
    
    // If get_account failed, try calling login_qrcode to check login status
    // If already logged in, it will return "already_logged_in" status
    if (!isLoggedIn && (!accountResult || accountResult.text?.includes('not found'))) {
      const loginQrResult = await this.mcpRequest('login_qrcode', {});
      if (loginQrResult) {
        // Check if response contains "already_logged_in"
        if (loginQrResult.status === 'already_logged_in' || 
            (loginQrResult.text && loginQrResult.text.includes('already_logged_in'))) {
          isLoggedIn = true;
        }
      }
    }
    
    if (isLoggedIn) {
      return { healthy: true, status: 'logged_in' };
    } else {
      return { healthy: false, status: 'not_logged_in' };
    }
  }
  
  async pollMessages() {
    // Check if we need to login
    const healthStatus = await this.healthCheck();
    if (!healthStatus.healthy) {
      await this.login();
    }
    
    const result = await this.mcpRequest('get_messages', { wait: true, timeout: 60000 });
    if (!result) {
      return null;
    }
    
    // Handle different response formats (result might be a text string containing JSON)
    let messages = [];
    if (result.messages) {
      messages = result.messages;
    } else if (result.text) {
      // Try to parse text as JSON
      try {
        const parsed = JSON.parse(result.text);
        messages = parsed.messages || [];
      } catch (e) {
        this.log(`Failed to parse messages: ${e.message}`);
        return null;
      }
    }
    
    if (!messages.length) {
      return null;
    }
    
    const processedMessages = [];
    for (const msg of messages) {
      // Handle different field names from MCP server
      const msgId = msg.message_id || msg.id || `msg_${this.messageIdCounter++}`;
      const sender = msg.from_user_id || msg.from || '';
      const text = msg.text || '';
      
      if (this.seenMessageIds.has(msgId.toString())) {
        continue;
      }
      this.seenMessageIds.add(msgId.toString());
      
      // Limit seen messages to avoid memory issues
      if (this.seenMessageIds.size > 1000) {
        // Remove oldest message ID
        const oldestId = this.seenMessageIds.values().next().value;
        this.seenMessageIds.delete(oldestId);
      }
      
      // Check allowlist
      if (!this._isAllowed(sender)) {
        this.log(`Message from ${sender} blocked by allowlist`);
        continue;
      }
      
      processedMessages.push({
        id: msgId,
        from: sender,
        text: text,
        chat_id: sender,
        is_group: false
      });
    }
    
    if (processedMessages.length) {
      return {
        next_cursor: Date.now().toString(),
        messages: processedMessages
      };
    }
    
    return null;
  }
  
  _isAllowed(sender) {
    const allowFrom = this.config.allowFrom || ['*'];
    if (allowFrom.includes('*')) {
      return true;
    }
    return allowFrom.includes(sender);
  }
  
  async sendMessage(to, text) {
    const result = await this.mcpRequest('send_text_message', { to, text });
    
    // Handle different response formats
    let success = false;
    if (result) {
      if (result.success) {
        success = true;
      } else if (result.text) {
        // Try to parse text as JSON
        try {
          const parsed = JSON.parse(result.text);
          success = parsed.success || false;
        } catch (e) {
          // If not JSON, check if text contains success info
          success = result.text.includes('success') || result.text.includes('ok');
        }
      }
    }
    
    if (success) {
      this.log(`Message sent to ${to}: ${text.substring(0, 50)}${text.length > 50 ? '...' : ''}`);
    } else {
      this.log(`Failed to send message to ${to}`);
    }
    return success;
  }
  
  async sendTyping(to, status) {
    const result = await this.mcpRequest('send_typing', { to, status });
    const success = result && result.success;
    if (success && status === 'typing') {
      this.log(`Typing indicator sent to ${to}`);
    }
    return success;
  }
  
  log(message) {
    console.error(`[wechat-plugin] ${message}`);
  }
  
  handleRequest(request) {
    const method = request.method;
    const params = request.params || {};
    
    try {
      if (method === 'get_manifest') {
        return { result: this.getManifest() };
      }
      
      else if (method === 'health') {
        return { result: { healthy: false, status: 'not_ready' } };
      }
      
      else if (method === 'start') {
        // Initialize plugin
        const runtime = params.runtime || {};
        this.stateDir = runtime.state_dir || '.';
        
        // Load config
        if (params.config) {
          this.config = { ...this.config, ...params.config };
        }
        
        // Start bridge
        const started = this.startBridge();
        if (!started) {
          return { result: { started: false } };
        }
        
        this.isRunning = true;
        
        // Try to login if not already logged in
        // Wait a bit for bridge to be ready
        setTimeout(async () => {
          try {
            const healthStatus = await this.healthCheck();
            if (!healthStatus.healthy) {
              this.log('Not logged in, starting auto-login...');
              await this.login();
            } else {
              this.log('Already logged in, skipping auto-login.');
            }
          } catch (error) {
            this.log(`Health check failed: ${error.message}`);
          }
        }, 3000);
        
        return { result: { started: true } };
      }
      
      else if (method === 'stop') {
        this.stopBridge();
        this.isRunning = false;
        return { result: { stopped: true } };
      }
      
      else if (method === 'send') {
        const message = params.message || {};
        const to = message.target || '';
        const text = message.text || '';
        
        if (!to || !text) {
          return { result: { accepted: false } };
        }
        
        // Handle asynchronously
        this.sendMessage(to, text).catch(error => {
          this.log(`Send message error: ${error.message}`);
        });
        
        return { result: { accepted: true } };
      }
      
      else if (method === 'send_typing') {
        const message = params.message || {};
        const to = message.target || '';
        const status = message.status || 'typing';
        
        if (!to) {
          return { result: { accepted: false } };
        }
        
        // Handle asynchronously
        this.sendTyping(to, status).catch(error => {
          this.log(`Send typing error: ${error.message}`);
        });
        
        return { result: { accepted: true } };
      }
      
      else if (method === 'poll') {
        // Handle asynchronously
        this.pollMessages().then(messages => {
          // This will be handled by the async response
        }).catch(error => {
          this.log(`Poll messages error: ${error.message}`);
        });
        
        return { result: { next_cursor: Date.now().toString(), messages: [] } };
      }
      
      else {
        return { error: { code: -32601, message: 'Method not found' } };
      }
    } catch (error) {
      this.log(`Error handling request: ${error.message}`);
      return { error: { code: -32603, message: `Internal error: ${error.message}` } };
    }
  }
  
  start() {
    this.log('Starting WeChat iLink plugin...');
    this.log('Press Ctrl+C to stop');
    
    // Handle incoming requests
    process.stdin.on('data', (data) => {
      const lines = data.toString().split('\n');
      for (const line of lines) {
        if (!line.trim()) continue;
        
        try {
          const request = JSON.parse(line.trim());
          this.log(`Received request: ${request.method} (id: ${request.id})`);
          
          const result = this.handleRequest(request);
          
          // Build JSON-RPC 2.0 response
          const buildResponse = (res) => ({
            jsonrpc: '2.0',
            id: request.id,
            ...res
          });
          
          // Handle both synchronous and asynchronous responses
          if (result instanceof Promise) {
            result.then(res => {
              const response = buildResponse(res);
              const responseStr = JSON.stringify(response) + '\n';
              this.log(`Sending response: ${responseStr.trim()}`);
              process.stdout.write(responseStr);
            }).catch(error => {
              const errorResponse = buildResponse({
                error: { code: -32603, message: `Internal error: ${error.message}` }
              });
              const responseStr = JSON.stringify(errorResponse) + '\n';
              this.log(`Sending error: ${responseStr.trim()}`);
              process.stdout.write(responseStr);
            });
          } else {
            const response = buildResponse(result);
            const responseStr = JSON.stringify(response) + '\n';
            this.log(`Sending response: ${responseStr.trim()}`);
            process.stdout.write(responseStr);
          }
        } catch (error) {
          const errorResponse = {
            jsonrpc: '2.0',
            id: null,
            error: { code: -32700, message: `Parse error: ${error.message}` }
          };
          const responseStr = JSON.stringify(errorResponse) + '\n';
          this.log(`Sending error: ${responseStr.trim()}`);
          process.stdout.write(responseStr);
        }
      }
    });
    
    // Handle process exit
    process.on('SIGINT', () => this.signalHandler());
    process.on('SIGTERM', () => this.signalHandler());
    
    process.on('exit', () => {
      this.stopBridge();
    });
  }
}

// Start the plugin
const plugin = new WeChatPlugin();
plugin.start();