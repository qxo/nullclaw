# WeChat iLink CLI 使用文档

## 概述

`wechat-cli.js` 是一个独立的微信命令行工具，不依赖 nullclaw，可以直接运行。

## 功能特性

- ✅ 独立运行，不依赖 nullclaw
- ✅ 支持扫码登录
- ✅ 支持发送文本消息
- ✅ 支持发送文件
- ✅ 支持轮询新消息
- ✅ 支持查看登录状态
- ✅ 支持退出登录
- ✅ 交互式命令行界面
- ✅ 完整的命令行参数支持

## 安装依赖

```bash
npm install
```

## 使用方法

### 1. 查看帮助

```bash
node wechat-cli.js help
```

### 2. 登录微信

```bash
node wechat-cli.js login
```

登录流程：
1. 自动获取二维码
2. 在控制台显示二维码（ASCII art 格式）
3. 用微信扫描二维码
4. 在微信端确认登录
5. Token 自动保存到 `~/.nullclaw/.weixin-token.json`

### 3. 发送消息

```bash
node wechat-cli.js send <用户ID> <消息>
```

示例：
```bash
node wechat-cli.js send user123 "你好，这是一条测试消息"
```

### 4. 发送文件

```bash
node wechat-cli.js file <用户ID> <文件路径>
```

示例：
```bash
node wechat-cli.js file user123 "./document.pdf"
node wechat-cli.js file user123 "./image.jpg"
```

支持的文件类型：
- 文档（PDF、Word、Excel 等）
- 图片（JPG、PNG、GIF 等）
- 视频（MP4、AVI 等）
- 音频（MP3、WAV 等）

### 5. 轮询新消息

```bash
node wechat-cli.js poll
```

轮询功能：
- 自动获取新消息
- 显示消息内容
- 显示媒体信息（图片、语音、视频、文件）
- 显示发送者信息

### 6. 查看登录状态

```bash
node wechat-cli.js status
```

显示信息：
- 登录状态
- Bot ID
- 用户 ID
- Base URL
- Token 保存时间

### 7. 退出登录

```bash
node wechat-cli.js logout
```

退出登录会：
- 删除保存的 token 文件
- 清除登录状态

### 8. 交互式模式

```bash
node wechat-cli.js interactive
```

交互式模式命令：
- `send <用户ID> <消息>` - 发送消息
- `file <用户ID> <文件路径>` - 发送文件
- `poll` - 轮询消息
- `status` - 查看状态
- `logout` - 退出登录
- `quit/exit` - 退出程序

## 配置

### Token 文件

默认位置：`~/.nullclaw/.weixin-token.json`

Token 文件内容：
```json
{
  "token": "your_bot_token",
  "baseUrl": "https://ilinkai.weixin.qq.com",
  "accountId": "your_bot_id",
  "userId": "your_user_id",
  "savedAt": "2026-03-23T00:00:00.000Z"
}
```

### 主目录

自动检测：
- Windows: `%USERPROFILE%`
- Linux/macOS: `$HOME`

## 消息类型支持

### 文本消息
- 纯文本消息
- 支持表情符号
- 支持多行文本

### 媒体消息
- **图片消息**：显示图片 URL、尺寸、大小
- **语音消息**：显示语音文本、播放时长
- **视频消息**：显示视频 URL、播放时长、大小
- **文件消息**：显示文件名、文件 URL、大小

## 错误处理

### 登录错误
- 网络连接失败
- 二维码过期（自动刷新，最多 3 次）
- 登录超时（5 分钟）
- 微信账号状态异常

### 消息发送错误
- 未登录
- 用户 ID 不存在
- 网络连接失败
- 文件不存在

### 轮询错误
- Session 过期（自动重新登录）
- 网络连接失败
- API 请求失败

## 使用示例

### 完整工作流程

```bash
# 1. 登录
node wechat-cli.js login

# 2. 查看状态
node wechat-cli.js status

# 3. 发送消息
node wechat-cli.js send user123 "你好，这是一条测试消息"

# 4. 发送文件
node wechat-cli.js file user123 "./document.pdf"

# 5. 轮询消息
node wechat-cli.js poll

# 6. 退出登录
node wechat-cli.js logout
```

### 交互式模式示例

```bash
# 进入交互式模式
node wechat-cli.js interactive

# 然后可以输入命令：
wechat> send user123 你好
wechat> file user123 ./test.pdf
wechat> poll
wechat> status
wechat> logout
wechat> quit
```

## 注意事项

1. **首次使用**：需要扫码登录微信
2. **Token 保存**：登录成功后 token 会自动保存，下次使用时无需重新登录
3. **二维码显示**：二维码会在控制台以 ASCII art 格式显示
4. **文件大小限制**：微信有文件大小限制，请确保文件大小在限制范围内
5. **网络连接**：需要稳定的网络连接
6. **微信账号**：确保微信账号状态正常，未被封禁
7. **Token 过期**：如果 session 过期，会自动提示重新登录

## 故障排除

### 登录失败
1. 检查网络连接是否正常
2. 检查微信账号状态是否正常
3. 检查是否有防火墙或代理限制
4. 删除 token 文件后重试

### 消息发送失败
1. 确认已登录（运行 `node wechat-cli.js status`）
2. 检查用户 ID 是否正确
3. 检查文件路径是否正确
4. 检查网络连接

### 二维码无法显示
1. 确保终端支持 ASCII art
2. 查看日志中的二维码 URL
3. 手动打开二维码 URL 进行扫描

## 与 nullclaw 插件的区别

### nullclaw 插件 (`nullclaw-plugin-wechat-ilink.js`)
- 作为 nullclaw 的外部通道运行
- 使用 JSON-RPC 协议与 nullclaw 通信
- 自动轮询消息并发送给 nullclaw
- 支持消息过滤、自动回复等高级功能
- 需要通过 nullclaw 启动

### CLI 工具 (`wechat-cli.js`)
- 独立运行，不依赖 nullclaw
- 直接通过命令行参数控制
- 适合脚本化和自动化
- 支持交互式操作
- 可以直接运行

## 技术细节

### 依赖
- Node.js 内置模块：`crypto`, `fs`, `path`, `readline`, `fs/promises`
- 外部依赖：`qrcode-terminal`（用于显示二维码）

### API 端点
- `ilink/bot/get_bot_qrcode` - 获取登录二维码
- `ilink/bot/get_qrcode_status` - 查询扫码状态
- `ilink/bot/sendmessage` - 发送消息
- `ilink/bot/getupdates` - 获取新消息（长轮询）

### 协议
- HTTP/HTTPS
- JSON 格式
- Base64 编码的 token 认证
- 随机 X-WECHAT-UIN 头

## 许可证

与主插件相同的许可证。

## 支持

如有问题，请查看主插件的 README.md 文档。