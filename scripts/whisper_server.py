#!/usr/bin/env python3
"""
faster-whisper HTTPサーバー
モデルを常駐させて高速応答

使用方法:
    python3 scripts/whisper_server.py

環境変数:
    WHISPER_MODEL: モデルサイズ (tiny, base, small, medium, large-v2, large-v3)
    WHISPER_DEVICE: デバイス (cuda, cpu)
    WHISPER_COMPUTE_TYPE: 計算精度 (float16, int8_float16, int8)
    WHISPER_PORT: サーバーポート
"""

import os
import sys
import json
import tempfile
import argparse
from http.server import HTTPServer, BaseHTTPRequestHandler

# 設定（環境変数またはデフォルト）
MODEL_SIZE = os.environ.get('WHISPER_MODEL', 'small')
DEVICE = os.environ.get('WHISPER_DEVICE', 'cuda')
COMPUTE_TYPE = os.environ.get('WHISPER_COMPUTE_TYPE', 'float16')
PORT = int(os.environ.get('WHISPER_PORT', '5001'))

# CUDAが使えない場合のフォールバック
def get_device():
    if DEVICE == 'cuda':
        try:
            import torch
            if torch.cuda.is_available():
                print(f"[whisper-server] CUDA available: {torch.cuda.get_device_name(0)}")
                return 'cuda'
            else:
                print("[whisper-server] CUDA not available, falling back to CPU")
                return 'cpu'
        except ImportError:
            print("[whisper-server] torch not installed, falling back to CPU")
            return 'cpu'
    return DEVICE

def get_compute_type(device):
    if device == 'cpu':
        return 'int8'  # CPUではfloat16は非効率
    return COMPUTE_TYPE

# モデルのロード
print(f"[whisper-server] Loading model: {MODEL_SIZE}")
actual_device = get_device()
actual_compute_type = get_compute_type(actual_device)
print(f"[whisper-server] Device: {actual_device}, Compute type: {actual_compute_type}")

try:
    from faster_whisper import WhisperModel
    model = WhisperModel(
        MODEL_SIZE,
        device=actual_device,
        compute_type=actual_compute_type
    )
    print(f"[whisper-server] Model loaded successfully")
except Exception as e:
    print(f"[whisper-server] Failed to load model: {e}")
    sys.exit(1)


class TranscribeHandler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            content_length = int(self.headers.get('Content-Length', 0))
            if content_length == 0:
                self.send_error_response("No audio data received")
                return

            wav_data = self.rfile.read(content_length)
            
            if len(wav_data) < 44:  # WAVヘッダ最小サイズ
                self.send_error_response("Invalid WAV data (too short)")
                return

            # 一時ファイルに保存
            with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp:
                tmp.write(wav_data)
                tmp_path = tmp.name

            try:
                # 認識実行
                segments, info = model.transcribe(
                    tmp_path,
                    language="ja",
                    beam_size=5, # 精度が悪ければ5にする
                    best_of=5, # 精度が悪ければ5にする
                    vad_filter=True,
                    vad_parameters=dict(
                        min_silence_duration_ms=1000,
                        speech_pad_ms=400,
                    ),
                    word_timestamps=False,
                    condition_on_previous_text=False,
                    initial_prompt="以下は、マイクからの入力音声に対する、ノイズを除去した日本語の文字起こしです。",
                    no_speech_threshold=0.6,
                )

                # セグメントを結合
                text_parts = []
                for seg in segments:
                    text_parts.append(seg.text)
                
                text = "".join(text_parts).strip()

                
                
                # Filter common hallucinations
                hallucinations = [
                    "ご視聴ありがとうございました",
                    "チャンネル登録",
                    "高評価",
                    "Subtitles by",
                    "Amara.org"
                ]
                
                for h in hallucinations:
                    if h in text:
                        text = ""
                        break
                
                result = {
                    "success": True,
                    "text": text,
                    "language": info.language,
                    "language_probability": info.language_probability,
                    "duration": info.duration,
                }

            finally:
                os.unlink(tmp_path)

            self.send_json_response(result)

        except Exception as e:
            import traceback
            traceback.print_exc()
            self.send_error_response(str(e))

    def do_GET(self):
        """ヘルスチェック用"""
        if self.path == '/health':
            self.send_json_response({
                "status": "ok",
                "model": MODEL_SIZE,
                "device": actual_device,
                "compute_type": actual_compute_type,
            })
        else:
            self.send_error(404)

    def send_json_response(self, data):
        response = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(200)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', len(response))
        self.end_headers()
        self.wfile.write(response)

    def send_error_response(self, error_message):
        result = {"success": False, "error": error_message}
        response = json.dumps(result, ensure_ascii=False).encode('utf-8')
        self.send_response(200)  # エラーでも200を返す（JSONでエラーを伝える）
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', len(response))
        self.end_headers()
        self.wfile.write(response)

    def log_message(self, format, *args):
        # アクセスログを出力
        print(f"[whisper-server] {args[0]}")


def main():
    parser = argparse.ArgumentParser(description='faster-whisper HTTP server')
    parser.add_argument('--port', type=int, default=PORT, help='Server port')
    parser.add_argument('--host', default='127.0.0.1', help='Server host')
    args = parser.parse_args()

    server_address = (args.host, args.port)
    httpd = HTTPServer(server_address, TranscribeHandler)
    
    print(f"[whisper-server] Listening on http://{args.host}:{args.port}")
    print(f"[whisper-server] Health check: http://{args.host}:{args.port}/health")
    print(f"[whisper-server] POST audio/wav to transcribe")
    
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n[whisper-server] Shutting down...")
        httpd.shutdown()


if __name__ == "__main__":
    main()