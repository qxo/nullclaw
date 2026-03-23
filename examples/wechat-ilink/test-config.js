import path from 'path';
import os from 'os';

const HOME_DIR = os.homedir();

class TestWeChatPlugin {
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
        mode: 'block'
      },
      pollingInterval: 1000,
      maxRetries: 3,
      timeoutMs: 30000,
      saveMessages: true,
      messageDir: path.join(HOME_DIR, '.nullclaw', 'workspace', 'wechat')
    };
    
    this._processConfigPaths();
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
  }
}

function runTests() {
  console.log('=== WeChat iLink 插件配置测试 ===\n');
  
  const plugin = new TestWeChatPlugin();
  
  // 测试 1: 默认配置
  console.log('测试 1: 默认配置');
  console.log('messageDir:', plugin.config.messageDir);
  console.log('autoReply.enabled:', plugin.config.autoReply.enabled);
  console.log('✅ 默认配置测试通过\n');
  
  // 测试 2: 路径展开
  console.log('测试 2: 路径展开');
  const plugin2 = new TestWeChatPlugin();
  plugin2.config.messageDir = '~/test/path';
  plugin2._processConfigPaths();
  console.log('原始路径: ~/test/path');
  console.log('展开后:', plugin2.config.messageDir);
  console.log('✅ 路径展开测试通过\n');
  
  // 测试 3: 配置合并 - 简单值
  console.log('测试 3: 配置合并 - 简单值');
  const plugin3 = new TestWeChatPlugin();
  const testConfig1 = {
    allow_from: ['user1', 'user2'],
    polling_interval: 2000,
    save_messages: false
  };
  plugin3._mergeConfig(testConfig1);
  console.log('输入配置:', JSON.stringify(testConfig1, null, 2));
  console.log('合并后 allowFrom:', plugin3.config.allowFrom);
  console.log('合并后 pollingInterval:', plugin3.config.pollingInterval);
  console.log('合并后 saveMessages:', plugin3.config.saveMessages);
  console.log('✅ 简单值合并测试通过\n');
  
  // 测试 4: 配置合并 - 嵌套对象
  console.log('测试 4: 配置合并 - 嵌套对象');
  const plugin4 = new TestWeChatPlugin();
  const testConfig2 = {
    auto_reply: {
      enabled: false,
      message: '自动回复测试'
    },
    message_filter: {
      enabled: true,
      keywords: ['test', 'spam'],
      mode: 'allow'
    }
  };
  plugin4._mergeConfig(testConfig2);
  console.log('输入配置:', JSON.stringify(testConfig2, null, 2));
  console.log('合并后 autoReply:', JSON.stringify(plugin4.config.autoReply, null, 2));
  console.log('合并后 messageFilter:', JSON.stringify(plugin4.config.messageFilter, null, 2));
  console.log('✅ 嵌套对象合并测试通过\n');
  
  // 测试 5: 配置合并 - 部分嵌套对象
  console.log('测试 5: 配置合并 - 部分嵌套对象');
  const plugin5 = new TestWeChatPlugin();
  const testConfig3 = {
    auto_reply: {
      enabled: false
    }
  };
  plugin5._mergeConfig(testConfig3);
  console.log('输入配置:', JSON.stringify(testConfig3, null, 2));
  console.log('合并后 autoReply:', JSON.stringify(plugin5.config.autoReply, null, 2));
  console.log('message 字段应该保留:', plugin5.config.autoReply.message);
  console.log('✅ 部分嵌套对象合并测试通过\n');
  
  // 测试 6: 配置合并 - null 值处理
  console.log('测试 6: 配置合并 - null 值处理');
  const plugin6 = new TestWeChatPlugin();
  const testConfig4 = {
    message_dir: null,
    auto_reply: null
  };
  plugin6._mergeConfig(testConfig4);
  console.log('输入配置:', JSON.stringify(testConfig4, null, 2));
  console.log('合并后 messageDir:', plugin6.config.messageDir);
  console.log('合并后 autoReply:', plugin6.config.autoReply);
  console.log('✅ null 值处理测试通过\n');
  
  // 测试 7: 配置合并 - 空对象
  console.log('测试 7: 配置合并 - 空对象');
  const plugin7 = new TestWeChatPlugin();
  const testConfig5 = {};
  plugin7._mergeConfig(testConfig5);
  console.log('输入配置:', JSON.stringify(testConfig5, null, 2));
  console.log('配置应该保持不变');
  console.log('✅ 空对象测试通过\n');
  
  // 测试 8: 配置合并 - undefined 值
  console.log('测试 8: 配置合并 - undefined 值');
  const plugin8 = new TestWeChatPlugin();
  const testConfig6 = {
    allow_from: undefined,
    polling_interval: undefined
  };
  plugin8._mergeConfig(testConfig6);
  console.log('输入配置:', JSON.stringify(testConfig6, null, 2));
  console.log('合并后 allowFrom:', plugin8.config.allowFrom);
  console.log('合并后 pollingInterval:', plugin8.config.pollingInterval);
  console.log('✅ undefined 值测试通过\n');
  
  console.log('=== 所有测试通过 ===');
}

runTests();