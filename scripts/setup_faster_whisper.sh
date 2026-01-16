#!/bin/bash
# faster-whisper セットアップスクリプト
# プロジェクトルートで実行: ./scripts/setup_faster_whisper.sh

set -e

echo "=== faster-whisper セットアップ ==="

# Python仮想環境の確認/作成
VENV_DIR=".venv"

if [ ! -d "$VENV_DIR" ]; then
    echo "Python仮想環境を作成中..."
    python3 -m venv "$VENV_DIR"
fi

# 仮想環境をアクティベート
source "$VENV_DIR/bin/activate"

echo "Python: $(which python)"
echo "Version: $(python --version)"

# pipのアップグレード
pip install --upgrade pip

# faster-whisperとPyTorchのインストール
echo "faster-whisperとPyTorchをインストール中..."
pip install faster-whisper torch

# CUDAの確認
echo ""
echo "=== CUDA確認 ==="
if command -v nvidia-smi &> /dev/null; then
    nvidia-smi --query-gpu=name,driver_version,memory.total --format=csv
    
    # PyTorchのCUDA確認
    python -c "
import torch
print(f'PyTorch version: {torch.__version__}')
print(f'CUDA available: {torch.cuda.is_available()}')
if torch.cuda.is_available():
    print(f'CUDA version: {torch.version.cuda}')
    print(f'cuDNN version: {torch.backends.cudnn.version()}')
    print(f'GPU: {torch.cuda.get_device_name(0)}')
"
else
    echo "nvidia-smi が見つかりません。GPU版は使用できません。"
    echo "CPU版で動作します。"
fi

# faster-whisperの確認
echo ""
echo "=== faster-whisper確認 ==="
python -c "
from faster_whisper import WhisperModel
print('faster-whisper インストール成功')

# 小さいモデルでテスト
import os
import tempfile
import wave
import numpy as np

# ダミー音声ファイル作成
with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as f:
    temp_path = f.name
    with wave.open(f.name, 'w') as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(16000)
        # 1秒の無音
        wav.writeframes(np.zeros(16000, dtype=np.int16).tobytes())

try:
    # tinyモデルでテスト（最小）
    print('tiny モデルをロード中...')
    model = WhisperModel('tiny', device='cpu', compute_type='int8')
    print('モデルロード成功')
    
    segments, info = model.transcribe(temp_path, language='ja')
    print(f'認識テスト成功 (duration: {info.duration:.2f}s)')
finally:
    os.unlink(temp_path)
"

echo ""
echo "=== セットアップ完了 ==="
echo ""
echo "使用方法:"
echo "  1. 仮想環境をアクティベート: source .venv/bin/activate"
echo "  2. サーバーを起動: python scripts/whisper_server.py"
echo ""
echo "環境変数で設定を変更できます:"
echo "  WHISPER_MODEL=small  (tiny, base, small, medium, large-v2, large-v3)"
echo "  WHISPER_DEVICE=cuda  (cuda, cpu)"
echo "  WHISPER_COMPUTE_TYPE=float16  (float16, int8_float16, int8)"
echo ""
echo "例: WHISPER_MODEL=base WHISPER_DEVICE=cuda python scripts/whisper_server.py"