#!/usr/bin/env python3
"""
faster-whisper による音声認識スクリプト
標準入力からWAVデータを受け取り，認識結果をJSONで出力
"""

import sys
import json
import io
import wave
from faster_whisper import WhisperModel

# モデルのロード（初回のみ）
# "tiny", "base", "small", "medium", "large-v2", "large-v3"
MODEL_SIZE = "small"  # 6GB VRAMで動作可能
DEVICE = "cuda"       # "cuda" or "cpu"
COMPUTE_TYPE = "float16"  # "float16", "int8_float16", "int8"

model = None

def load_model():
    global model
    if model is None:
        sys.stderr.write(f"[faster-whisper] Loading model: {MODEL_SIZE}\n")
        model = WhisperModel(
            MODEL_SIZE,
            device=DEVICE,
            compute_type=COMPUTE_TYPE
        )
        sys.stderr.write(f"[faster-whisper] Model loaded\n")
    return model

def transcribe_wav(wav_bytes: bytes) -> dict:
    """WAVバイト列を認識"""
    model = load_model()
    
    # バイト列からWAVを読み込み
    with io.BytesIO(wav_bytes) as wav_io:
        with wave.open(wav_io, 'rb') as wav_file:
            # サンプルレート確認
            sample_rate = wav_file.getframerate()
            if sample_rate != 16000:
                sys.stderr.write(f"[faster-whisper] Warning: sample rate {sample_rate} != 16000\n")
    
    # 一時ファイルに書き出し（faster-whisperはファイルパスを要求）
    import tempfile
    import os
    
    with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp:
        tmp.write(wav_bytes)
        tmp_path = tmp.name
    
    try:
        # 認識実行
        segments, info = model.transcribe(
            tmp_path,
            language="ja",
            beam_size=5,
            vad_filter=True,  # VADで無音区間をスキップ
            vad_parameters=dict(
                min_silence_duration_ms=500,
            )
        )
        
        # セグメントを結合
        text = "".join([seg.text for seg in segments])
        
        return {
            "success": True,
            "text": text.strip(),
            "language": info.language,
            "duration": info.duration,
        }
    finally:
        os.unlink(tmp_path)

def main():
    """標準入力からWAVデータを読み込み，認識結果を出力"""
    # バイナリモードで標準入力を読み込み
    wav_data = sys.stdin.buffer.read()
    
    if len(wav_data) < 44:  # WAVヘッダ最小サイズ
        result = {"success": False, "error": "Invalid WAV data"}
    else:
        try:
            result = transcribe_wav(wav_data)
        except Exception as e:
            result = {"success": False, "error": str(e)}
    
    # JSON出力
    print(json.dumps(result, ensure_ascii=False))

if __name__ == "__main__":
    main()
