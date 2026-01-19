export /**
 * WAVヘッダーを付与してバッファを作成する
 * @param audioData PCM音声データ
 * @param sampleRate サンプリングレート
 * @param channels チャンネル数 (デフォルト: 1)
 * @param bitDepth ビット深度 (デフォルト: 16)
 */
    function createWavBuffer(
        audioData: Buffer,
        sampleRate: number,
        channels: number = 1,
        bitDepth: number = 16
    ): Buffer {
    const byteRate = sampleRate * channels * (bitDepth / 8);
    const blockAlign = channels * (bitDepth / 8);
    const dataSize = audioData.length;
    const headerSize = 44;

    const buffer = Buffer.alloc(headerSize + dataSize);

    // RIFF header
    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(36 + dataSize, 4);
    buffer.write('WAVE', 8);

    // fmt chunk
    buffer.write('fmt ', 12);
    buffer.writeUInt32LE(16, 16);           // chunk size
    buffer.writeUInt16LE(1, 20);            // PCM format
    buffer.writeUInt16LE(channels, 22);
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(byteRate, 28);
    buffer.writeUInt16LE(blockAlign, 32);
    buffer.writeUInt16LE(bitDepth, 34);

    // data chunk
    buffer.write('data', 36);
    buffer.writeUInt32LE(dataSize, 40);
    audioData.copy(buffer, 44);

    return buffer;
}
