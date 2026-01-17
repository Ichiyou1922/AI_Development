#!/bin/bash

# カラー定義
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${GREEN}=== AI Agent Development Start Script ===${NC}"

# 1. Ollama Check
echo -e "${YELLOW}[1/3] Checking Ollama...${NC}"
if ! pgrep -x "ollama" > /dev/null; then
    echo "Ollama is not running. Starting Ollama serve..."
    ollama serve > /dev/null 2>&1 &
    OLLAMA_PID=$!
    echo "Ollama started (PID: $OLLAMA_PID)"
    
    # 起動待機
    echo "Waiting for Ollama API..."
    until curl -s http://localhost:11434/api/tags > /dev/null; do
        sleep 1
    done
else
    echo "Ollama is already running."
fi
echo -e "${GREEN}Ollama is ready.${NC}"

# 2. VOICEVOX Engine (Docker) Check
echo -e "\n${YELLOW}[2/3] Checking VOICEVOX Engine (Docker/CPU)...${NC}"
# GPU版が起動している場合は停止
if [ "$(sudo docker ps -q -f name=voicevox_engine_gpu)" ]; then
    echo "Stopping running GPU Voicevox container..."
    sudo docker stop voicevox_engine_gpu > /dev/null
fi

CONTAINER_NAME="voicevox_engine_cpu"
IMAGE_NAME="voicevox/voicevox_engine:cpu-ubuntu20.04-latest"

if [ ! "$(sudo docker ps -q -f name=$CONTAINER_NAME)" ]; then
    if [ "$(sudo docker ps -aq -f status=exited -f name=$CONTAINER_NAME)" ]; then
        # 停止中のコンテナがあれば再開
        echo "Starting existing VOICEVOX container..."
        sudo docker start $CONTAINER_NAME
    else
        # 新規起動
        echo "Starting new VOICEVOX container..."
        # ポート50021を使用
        sudo docker run --rm -d -p 50021:50021 --name $CONTAINER_NAME $IMAGE_NAME
    fi
    
    # 起動待機
    echo "Waiting for VOICEVOX API..."
    until curl -s http://localhost:50021/version > /dev/null; do
        sleep 1
    done
else
    echo "VOICEVOX Engine is already running."
fi
echo -e "${GREEN}VOICEVOX Engine is ready.${NC}"

# 3. Start Application
echo -e "\n${YELLOW}[3/3] Starting AI Agent Application...${NC}"

# 終了時にクリーンアップする関数
cleanup() {
    echo -e "\n${YELLOW}Shutting down...${NC}"
    # Dockerコンテナは --rm なので stop すれば消えるが、
    # 開発中は次回起動を早くするために stop だけにしておくのが一般的。
    echo "Stopping VOICEVOX container..."
    sudo docker stop $CONTAINER_NAME > /dev/null
    
    if [ ! -z "$OLLAMA_PID" ]; then
        echo "Stopping Ollama process..."
        kill $OLLAMA_PID
    fi
    exit
}

# Ctrl+C を捕捉
trap cleanup SIGINT SIGTERM

# アプリ起動
npm start

cleanup
