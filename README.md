# NebulaEncrypt - Chrome Extension for Secure, Local-Only Encryption on Telegram Web

NebulaEncrypt is a powerful Chrome extension designed to ensure your messages on [Telegram Web](https://web.telegram.org) are encrypted locally, keeping your communications secure and private. All encryption and decryption operations happen directly on your device, and your encryption keys are stored only locally. This guarantees that even if someone intercepts your messages, they remain unreadable without your private key.

## Why NebulaEncrypt?

In an era where digital privacy is paramount, NebulaEncrypt offers a robust solution for secure messaging on Telegram Web. By ensuring that encryption happens entirely on your device, NebulaEncrypt keeps your messages safe from prying eyes. Your encryption keys never leave your computer, ensuring that only you can decrypt your messages.

## Features

- **Local Encryption on Telegram Web**: All encryption and decryption processes occur locally on your device. Your data and keys are never transmitted over the network.
- **Secure Key Storage**: Encryption keys are stored securely and only locally. No one else has access to them, ensuring that only you can decrypt your messages.
- **Automatic Encryption**: Automatically encrypt your messages before sending them with a simple hotkey or automatically when you click send or press `Enter`.
- **Automatic Decryption**: Automatically decrypt incoming messages on Telegram Web so you can read them in plaintext.
- **Seamless Integration**: Integrates directly with Telegram Web without disrupting your workflow.
- **Real-time Processing**: Messages are encrypted and decrypted in real-time, ensuring seamless communication without compromising security.

## Platform Support

Currently, NebulaEncrypt is designed and optimized to work exclusively with [Telegram Web](https://web.telegram.org). We are committed to providing the best possible experience on this platform, ensuring that your messages remain secure.

### Want to Help Expand NebulaEncrypt?

We are excited to explore expanding NebulaEncrypt to support other messaging platforms. If you're a developer interested in contributing, we welcome pull requests (PRs) to extend support to other platforms. Your contributions can help make NebulaEncrypt a more versatile tool for secure messaging across the web.

## Getting Started

### Installation

1. Clone or download the repository.
2. Open Chrome and navigate to `chrome://extensions/`.
3. Enable "Developer mode" in the top-right corner.
4. Click "Load unpacked" and select the directory containing the extension files.
5. The NebulaEncrypt extension will now be loaded into your browser.

### Usage

1. **Set Your Key**: Click on the extension icon in your browser toolbar to open the popup. Set your encryption/decryption key. This key is stored locally on your device and never leaves it.
2. **Encrypt Messages**: Write your message in the Telegram Web input field, press `Ctrl+X` and after that `Enter` or click send.
3. **Decrypt Messages**: Incoming encrypted messages on Telegram Web will be automatically decrypted and displayed in plaintext, provided you have the correct key.

### Hotkeys

- **Encrypt Text in Input**: `Ctrl+Q` (or your configured hotkey) - Encrypts the text currently in the Telegram Web input field before sending.
- **Decrypt All Messages**: `Ctrl+X` (or your configured hotkey) - Manually triggers the decryption of all received encrypted messages on Telegram Web.

## Technical Details

- **AES-GCM Encryption**: Uses the AES-GCM algorithm for strong encryption, performed entirely on your device.
- **Local Storage of Keys**: Encryption keys are stored securely on your device and never transmitted. Your keys never leave your device, ensuring complete control over your encrypted communications.
- **No Network Involvement**: All encryption and decryption processes occur locally, with no network interactions involved in handling your keys or unencrypted data.

## Troubleshooting

- **Encrypted Message Not Sent**: Ensure the input field is correctly detected by the extension, and make sure your key is properly set in the extension.
- **Decryption Issues**: Double-check that the correct encryption key is set in the extension. Without the correct key, messages cannot be decrypted.

## Contributing

We are always looking to improve NebulaEncrypt, and we'd love to see it support more platforms beyond Telegram Web. If you're interested in contributing, feel free to fork the repository and submit a pull request (PR). Let's work together to make secure messaging accessible on more platforms.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgements

- AES-GCM encryption is provided by the Web Cryptography API.
- Inspired by the need for truly secure, local-only encryption in an increasingly connected world.

---

**Protect your communications on Telegram Web with NebulaEncrypt - because your privacy matters.**
