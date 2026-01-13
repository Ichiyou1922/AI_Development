const messagesContainer = document.getElementById('messages') as HTMLDivElement;
const userInput = document.getElementById('user-input') as HTMLInputElement;
const sendButton = document.getElementById('send-button') as HTMLButtonElement;

function addMessage(role: 'user' | 'assistant', text: string): void {
  const messageDiv = document.createElement('div');
  messageDiv.className = `message ${role}`;
  
  const roleLabel = document.createElement('div');
  roleLabel.className = 'role';
  roleLabel.textContent = role === 'user' ? 'You' : 'AI';
  
  const contentDiv = document.createElement('div');
  contentDiv.className = 'content';
  contentDiv.textContent = text;
  
  messageDiv.appendChild(roleLabel);
  messageDiv.appendChild(contentDiv);
  messagesContainer.appendChild(messageDiv);
  
  // 最下部にスクロール
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

async function sendMessage(): Promise<void> {
  const message = userInput.value.trim();
  if (!message) return;
  
  // UIの更新
  userInput.value = '';
  sendButton.disabled = true;
  addMessage('user', message);
  
  try {
    const response = await window.electronAPI.sendMessage(message);
    
    if (response.success && response.text) {
      addMessage('assistant', response.text);
    } else {
      addMessage('assistant', `エラー: ${response.error}`);
    }
  } catch (error) {
    addMessage('assistant', `通信エラー: ${error}`);
  } finally {
    sendButton.disabled = false;
    userInput.focus();
  }
}

// イベントリスナー
sendButton.addEventListener('click', sendMessage);
userInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    sendMessage();
  }
});

// 初期フォーカス
userInput.focus();