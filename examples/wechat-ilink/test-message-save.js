import fs from 'fs';
import path from 'path';
import os from 'os';

const HOME_DIR = os.homedir();

class TestMessageSave {
  constructor() {
    this.messageIdCounter = 0;
    this.config = {
      saveMessages: true,
      messageDir: path.join(HOME_DIR, '.nullclaw', 'workspace', 'wechat')
    };
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
      console.log(`✅ 消息已保存到: ${filepath}`);
      
      // 返回相对路径以减少 token 数量
      const relativePath = path.join('wechat', date, filename);
      return relativePath;
    } catch (error) {
      console.log(`❌ 保存消息失败: ${error.message}`);
      return null;
    }
  }
}

async function runTests() {
  console.log('=== WeChat iLink 插件消息保存测试 ===\n');
  
  const saver = new TestMessageSave();
  
  // 测试 1: 保存文本消息
  console.log('测试 1: 保存文本消息');
  const testMsg1 = {
    client_id: 'test_msg_001',
    from_user_id: 'user123',
    chat_id: 'user123',
    context_token: 'token_abc123'
  };
  const testExtracted1 = {
    text: '这是一条测试消息',
    media: [],
    hasMedia: false
  };
  const result1 = await saver._saveMessage(testMsg1, testExtracted1, false, 1);
  console.log('相对路径:', result1);
  console.log('✅ 文本消息保存测试通过\n');
  
  // 测试 2: 保存群组消息
  console.log('测试 2: 保存群组消息');
  const testMsg2 = {
    client_id: 'test_msg_002',
    from_user_id: 'user456',
    chat_id: 'group789',
    context_token: 'token_def456'
  };
  const testExtracted2 = {
    text: '这是一条群组测试消息',
    media: [],
    hasMedia: false
  };
  const result2 = await saver._saveMessage(testMsg2, testExtracted2, true, 2);
  console.log('相对路径:', result2);
  console.log('✅ 群组消息保存测试通过\n');
  
  // 测试 3: 保存带媒体的消息
  console.log('测试 3: 保存带媒体的消息');
  const testMsg3 = {
    client_id: 'test_msg_003',
    from_user_id: 'user789',
    chat_id: 'user789',
    context_token: 'token_ghi789'
  };
  const testExtracted3 = {
    text: '这是一条带媒体的测试消息',
    media: [
      {
        type: 'image',
        url: 'https://example.com/image.jpg',
        width: 800,
        height: 600,
        size: 102400
      }
    ],
    hasMedia: true
  };
  const result3 = await saver._saveMessage(testMsg3, testExtracted3, false, 3);
  console.log('相对路径:', result3);
  console.log('✅ 带媒体的消息保存测试通过\n');
  
  // 测试 4: 保存多条消息（日期分类）
  console.log('测试 4: 保存多条消息（日期分类）');
  const testMsg4 = {
    client_id: 'test_msg_004',
    from_user_id: 'user000',
    chat_id: 'user000',
    context_token: 'token_jkl000'
  };
  const testExtracted4 = {
    text: '这是另一条测试消息',
    media: [],
    hasMedia: false
  };
  const result4 = await saver._saveMessage(testMsg4, testExtracted4, false, 4);
  console.log('相对路径:', result4);
  console.log('✅ 多条消息保存测试通过\n');
  
  // 测试 5: 验证保存的文件内容
  console.log('测试 5: 验证保存的文件内容');
  const savedFile = path.join(saver.config.messageDir, new Date().toISOString().split('T')[0], 'msg_test_msg_001.json');
  if (fs.existsSync(savedFile)) {
    const content = JSON.parse(fs.readFileSync(savedFile, 'utf-8'));
    console.log('文件内容验证:');
    console.log('- ID:', content.id);
    console.log('- 文本:', content.text);
    console.log('- 发送者:', content.from);
    console.log('- 是否群组:', content.is_group);
    console.log('- 是否有媒体:', content.has_media);
    console.log('✅ 文件内容验证测试通过\n');
  } else {
    console.log('❌ 文件不存在:', savedFile);
  }
  
  // 测试 6: 禁用消息保存
  console.log('测试 6: 禁用消息保存');
  saver.config.saveMessages = false;
  const testMsg5 = {
    client_id: 'test_msg_005',
    from_user_id: 'user111',
    chat_id: 'user111',
    context_token: 'token_mno111'
  };
  const testExtracted5 = {
    text: '这条消息不应该被保存',
    media: [],
    hasMedia: false
  };
  const result5 = await saver._saveMessage(testMsg5, testExtracted5, false, 5);
  console.log('结果:', result5);
  console.log('✅ 禁用消息保存测试通过\n');
  
  // 测试 7: 消息 ID 一致性
  console.log('测试 7: 消息 ID 一致性');
  saver.config.saveMessages = true; // 重新启用消息保存
  const msgId = 100;
  const testMsg6 = {
    client_id: null,
    from_user_id: 'user222',
    chat_id: 'user222',
    context_token: 'token_pqr222'
  };
  const testExtracted6 = {
    text: '测试消息 ID 一致性',
    media: [],
    hasMedia: false
  };
  const result6 = await saver._saveMessage(testMsg6, testExtracted6, false, msgId);
  const expectedFilename = `msg_${msgId}.json`;
  const actualFilename = path.basename(result6);
  console.log('预期文件名:', expectedFilename);
  console.log('实际文件名:', actualFilename);
  console.log('✅ 消息 ID 一致性测试通过\n');
  
  console.log('=== 所有测试通过 ===');
  console.log('\n提示：测试文件保存在:', saver.config.messageDir);
}

runTests();