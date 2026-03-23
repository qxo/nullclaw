# WeChat iLink 外部通道插件

本插件实现了通过 MCP WeChat Server 与微信的集成，无需公众号，只需扫码即可登录使用。

## 功能特性

- ✅ 微信扫码登录，无需公众号
- ✅ 文本消息收发
- ✅ 打字指示器
- ✅ 健康状态检查
- ✅ 自动重连

## 版本选择

### Node.js 版本（推荐）
- **文件**：`nullclaw-plugin-wechat-ilink.js`
- **优势**：直接集成 mcp-wechat-server，无额外依赖
- **要求**：Node.js 14.0+

### Python 版本
- **文件**：`nullclaw-plugin-wechat-ilink`
- **优势**：跨平台兼容性好
- **要求**：Python 3.7+, Node.js 14.0+

## 环境要求

- Node.js 14.0+ 和 npm
- `mcp-wechat-server` 包

## 快速开始

### 1. 安装依赖

```bash
# 全局安装 MCP WeChat Server
npm install -g mcp-wechat-server

# Windows 用户可能需要以管理员身份运行
```

### 2. 配置文件

#### 方法 1：直接复制配置文件（推荐）
将 `examples/wechat-ilink/config.example.json` 复制到你的 nullclaw 配置目录：

```bash
# Windows
copy examples\wechat-ilink\config.example.json %USERPROFILE%\.nullclaw\config.json

# Linux/Mac
cp examples/wechat-ilink/config.example.json ~/.nullclaw/config.json
```

#### 方法 2：手动配置
在 `~/.nullclaw/config.json` 中添加以下配置：

#### Node.js 版本配置（推荐）：

```json
{
  "channels": {
    "external": {
      "accounts": {
        "wechat-ilink": {
          "runtime_name": "wechat_ilink",
          "transport": {
            "command": "node",
            "args": ["nullclaw-plugin-wechat-ilink.js"],
            "timeout_ms": 120000
          },
          "config": {
            "allow_from": ["*"],
            "group_policy": "allowlist"
          }
        }
      }
    }
  }
}
```

#### Python 版本配置：

```json
{
  "channels": {
    "external": {
      "accounts": {
        "wechat-ilink": {
          "runtime_name": "wechat_ilink",
          "transport": {
            "command": "python3",
            "args": ["nullclaw-plugin-wechat-ilink.py"],
            "timeout_ms": 120000
          },
          "config": {
            "allow_from": ["*"],
            "group_policy": "allowlist"
          }
        }
      }
    }
  }
}
```

### 3. 启动插件

```bash
# 启动微信通道
nullclaw channel start wechat_ilink

# 查看通道状态
nullclaw channel status wechat_ilink
```

## 登录流程

1. 插件启动后，会在控制台生成微信登录二维码
2. 打开微信，点击「发现」→「扫一扫」
3. 扫描控制台显示的二维码
4. 在微信中确认登录
5. 登录成功后，插件会自动开始监听消息

## 配置选项

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| `allow_from` | 允许的发信人列表，`["*"]` 表示允许所有人 | `["*"]` |
| `group_allow_from` | 允许的群聊列表，默认使用 `allow_from` | 无 |
| `group_policy` | 群聊处理模式：`allowlist`（白名单）、`open`（开放）、`disabled`（禁用） | `allowlist` |
| `bridge_command` | 自定义 MCP WeChat Server 启动命令 | `npx mcp-wechat-server` |
| `bridge_dir` | 运行桥接命令的目录 | 当前目录 |

## 使用示例

### 发送消息

```bash
# 发送文本消息
nullclaw channel send wechat_ilink --target "wxid_1234567890" --text "你好，这是一条测试消息"
```

### 查看消息

插件会自动监听并处理微信消息，消息会通过 nullclaw 的消息系统分发。

## 常见问题

### 1. 桥接服务启动失败
- 确保已全局安装 `mcp-wechat-server`
- 检查 Node.js 和 npm 是否正确安装
- 尝试手动运行 `npx mcp-wechat-server` 查看错误信息

### 2. 登录超时
- 确保在 60 秒内扫描二维码
- 检查网络连接是否稳定
- 尝试重新启动插件

### 3. 消息收发问题
- 确保微信应用在手机上正常运行
- 验证登录状态是否仍然有效
- 检查网络连接

### 4. 权限问题
- Windows 用户可能需要以管理员身份运行命令
- 确保插件脚本有执行权限

## 技术原理

1. **插件协议**：使用 nullclaw 外部通道 JSON-RPC/stdio 协议
2. **通信桥梁**：通过 MCP WeChat Server 与微信通信
3. **登录方式**：基于微信网页版协议，扫码登录
4. **消息处理**：实时轮询微信消息，支持文本消息

## 注意事项

- 本插件使用个人微信账号登录，无需公众号
- 登录状态会在插件重启后失效，需要重新扫码登录
- 消息历史不会在重启后保留
- 需要稳定的网络连接来与微信服务器通信
- 请遵守微信使用规范，避免滥用导致账号被封

## 文件结构

```
examples/wechat-ilink/
├── nullclaw-plugin-wechat-ilink.js  # Node.js 版本（推荐）
├── nullclaw-plugin-wechat-ilink     # Python 版本
├── README.md                        # 中文说明文档
├── README-EN.md                     # 英文说明文档
└── config.example.json              # 配置示例
```

## 版本要求

- nullclaw: 最新版本
- Node.js: 14.0+（两个版本都需要）
- Python: 3.7+（仅 Python 版本需要）
- mcp-wechat-server: 1.0.0+