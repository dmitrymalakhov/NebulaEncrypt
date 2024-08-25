# NebulaEncrypt - Chrome Extension for Secure, Local-Only Encryption

NebulaEncrypt is a powerful Chrome extension that ensures your messages are encrypted locally, keeping your communications secure and private. With NebulaEncrypt, all encryption and decryption operations happen on your device, and your encryption keys are stored only locally. This means that even if someone intercepts your messages, they will remain unreadable without your private key.

## Why NebulaEncrypt?

In today's digital world, privacy is more important than ever. NebulaEncrypt is built with one primary goal: to keep your messages secure by ensuring that encryption happens entirely on your device. Your keys never leave your computer, and neither do your unencrypted messages. This makes NebulaEncrypt a perfect choice for those who value their privacy and security.

## Features

- **Local Encryption**: All encryption and decryption processes occur locally on your device. Your data and keys are never transmitted over the network.
- **Secure Key Storage**: Encryption keys are stored securely and only locally. No one else has access to them, ensuring that only you can decrypt your messages.
- **Automatic Encryption**: Automatically encrypt your messages before sending them with a simple hotkey or automatically when you click send.
- **Automatic Decryption**: Automatically decrypt incoming messages so you can read them in plaintext.
- **Seamless Integration**: Integrates directly with your favorite messaging platforms without disrupting your workflow.
- **Real-time Processing**: Messages are encrypted and decrypted in real-time, ensuring seamless communication without compromising security.

## How It Works

### Local-Only Encryption

1. **Encryption**: Before a message is sent, NebulaEncrypt encrypts it locally using the AES-GCM algorithm. Your private key, stored securely on your device, is used for encryption. The encrypted message is then sent, ensuring that no one can read it without your key.
2. **Decryption**: When you receive an encrypted message, NebulaEncrypt decrypts it locally on your device using your private key. This ensures that only you can read the message, even if it was intercepted by someone else.

### Security by Design

- **Keys Never Leave Your Device**: Your encryption keys are generated and stored only on your device. They are never transmitted over the network, making it impossible for anyone else to intercept them.
- **End-to-End Encryption**: Even if someone gains access to your messages, they won't be able to read them without the corresponding key, which is stored securely on your device.

## Getting Started

### Installation

1. Clone or download the repository.
2. Open Chrome and navigate to `chrome://extensions/`.
3. Enable "Developer mode" in the top-right corner.
4. Click "Load unpacked" and select the directory containing the extension files.
5. The NebulaEncrypt extension will now be loaded into your browser.

### Usage

1. **Set Your Key**: Click on the extension icon in your browser toolbar to open the popup. Set your encryption/decryption key. This key is stored locally on your device and never leaves it.
2. **Encrypt Messages**: Write your message in the messaging platform, press `Ctrl+Q` and press `Enter` or click send, and NebulaEncrypt will automatically encrypt the message before it is sent.
3. **Decrypt Messages**: Incoming encrypted messages will be automatically decrypted and displayed in plaintext, provided you have the correct key.

### Hotkeys

- **Encrypt Text in Input**: `Ctrl+Q` - Encrypts the text currently in the input field before sending.
- **Decrypt All Messages**: `Ctrl+X` - Manually triggers the decryption of all received encrypted messages.

## Technical Details

- **AES-GCM Encryption**: Uses the AES-GCM algorithm for strong encryption, performed entirely on your device.
- **Local Storage of Keys**: Encryption keys are stored securely on your device and never transmitted. Your keys never leave your device, ensuring complete control over your encrypted communications.
- **No Network Involvement**: All encryption and decryption processes occur locally, with no network interactions involved in handling your keys or unencrypted data.

## Troubleshooting

- **Encrypted Message Not Sent**: Ensure the input field is correctly detected by the extension, and make sure your key is properly set in the extension.
- **Decryption Issues**: Double-check that the correct encryption key is set in the extension. Without the correct key, messages cannot be decrypted.

## Contributing

Contributions are welcome! If you'd like to contribute to NebulaEncrypt, feel free to fork the repository and submit a pull request. For major changes, please open an issue first to discuss what you'd like to change.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgements

- AES-GCM encryption is provided by the Web Cryptography API.
- Inspired by the need for truly secure, local-only encryption in an increasingly connected world.

---

**Protect your communications with NebulaEncrypt - because your privacy matters.**
