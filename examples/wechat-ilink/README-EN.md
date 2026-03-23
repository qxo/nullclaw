# WeChat iLink External Plugin

This plugin integrates with WeChat via the MCP WeChat Server, no WeChat Official Account required - just scan the QR code to login.

## Features

- ✅ WeChat QR code login, no WeChat Official Account needed
- ✅ Text message sending and receiving
- ✅ Typing indicators
- ✅ Health status checking
- ✅ Auto-reconnect

## Version Options

### Node.js Version (Recommended)
- **File**: `nullclaw-plugin-wechat-ilink.js`
- **Advantages**: Direct integration with mcp-wechat-server, no extra dependencies
- **Requirements**: Node.js 14.0+

### Python Version
- **File**: `nullclaw-plugin-wechat-ilink`
- **Advantages**: Better cross-platform compatibility
- **Requirements**: Python 3.7+, Node.js 14.0+

## Requirements

- Node.js 14.0+ and npm
- `mcp-wechat-server` package

## Quick Start

### 1. Install Dependencies

```bash
# Install MCP WeChat Server globally
npm install -g mcp-wechat-server

# Windows users may need to run as administrator
```

### 2. Configuration

#### Method 1: Copy configuration file (Recommended)
Copy `examples/wechat-ilink/config.example.json` to your nullclaw config directory:

```bash
# Windows
copy examples\wechat-ilink\config.example.json %USERPROFILE%\.nullclaw\config.json

# Linux/Mac
cp examples/wechat-ilink/config.example.json ~/.nullclaw/config.json
```

#### Method 2: Manual configuration
Add the following configuration to `~/.nullclaw/config.json`:

#### Node.js Version Configuration (Recommended):

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

#### Python Version Configuration:

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

### 3. Start the Plugin

```bash
# Start WeChat channel
nullclaw channel start wechat_ilink

# Check channel status
nullclaw channel status wechat_ilink
```

## Login Process

1. When the plugin starts, it will generate a WeChat login QR code in the console
2. Open WeChat on your phone, go to "Discover" → "Scan QR Code"
3. Scan the QR code displayed in the console
4. Confirm login in WeChat
5. Once logged in, the plugin will automatically start listening for messages

## Configuration Options

| Option | Description | Default |
|--------|-------------|--------|
| `allow_from` | Allowlist of senders, `["*"]` allows everyone | `["*"]` |
| `group_allow_from` | Allowlist of groups, falls back to `allow_from` if not set | None |
| `group_policy` | Group handling mode: `allowlist`, `open`, or `disabled` | `allowlist` |
| `bridge_command` | Custom MCP WeChat Server start command | `npx mcp-wechat-server` |
| `bridge_dir` | Directory to run the bridge command from | Current directory |

## Usage Examples

### Send Message

```bash
# Send text message
nullclaw channel send wechat_ilink --target "wxid_1234567890" --text "Hello, this is a test message"
```

### Receive Messages

The plugin will automatically listen for and process WeChat messages, which will be distributed through nullclaw's message system.

## Troubleshooting

### 1. Bridge Service Fails to Start
- Make sure `mcp-wechat-server` is installed globally
- Check that Node.js and npm are properly installed
- Try running `npx mcp-wechat-server` manually to see error messages

### 2. Login Timeout
- Make sure you scan the QR code within 60 seconds
- Check that you have a stable internet connection
- Try restarting the plugin

### 3. Message Sending/Receiving Issues
- Make sure the WeChat app is running on your phone
- Verify that the login is still active
- Check your network connection

### 4. Permission Issues
- Windows users may need to run commands as administrator
- Ensure the plugin script has execute permissions

## Technical Principles

1. **Plugin Protocol**: Uses nullclaw ExternalChannel JSON-RPC/stdio protocol
2. **Communication Bridge**: Communicates with WeChat through MCP WeChat Server
3. **Login Method**: Based on WeChat web protocol, QR code login
4. **Message Processing**: Real-time polling for WeChat messages, supports text messages

## Notes

- This plugin uses personal WeChat account login, no WeChat Official Account required
- Login status will be lost after plugin restart, requiring re-scanning of the QR code
- Message history is not persisted between restarts
- Requires a stable internet connection to communicate with WeChat servers
- Please follow WeChat usage guidelines to avoid account suspension

## File Structure

```
examples/wechat-ilink/
├── nullclaw-plugin-wechat-ilink.js  # Node.js version (recommended)
├── nullclaw-plugin-wechat-ilink     # Python version
├── README.md                        # Chinese documentation
├── README-EN.md                     # English documentation
└── config.example.json              # Configuration example
```

## Version Requirements

- nullclaw: Latest version
- Node.js: 14.0+ (required for both versions)
- Python: 3.7+ (only required for Python version)
- mcp-wechat-server: 1.0.0+