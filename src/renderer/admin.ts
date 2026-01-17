// 管理モード専用スクリプト

// TypeScriptにモジュールとして認識させる（グローバルスコープの重複エラー回避）
export {};

// ============================================================
// タブ切り替え
// ============================================================

const tabButtons = document.querySelectorAll('.tab-btn');
const tabContents = document.querySelectorAll('.tab-content');

tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
        const tabId = btn.getAttribute('data-tab');
        if (!tabId) return;

        // すべてのタブを非アクティブに
        tabButtons.forEach(b => b.classList.remove('active'));
        tabContents.forEach(c => c.classList.remove('active'));

        // 選択したタブをアクティブに
        btn.classList.add('active');
        const content = document.getElementById(`tab-${tabId}`);
        if (content) {
            content.classList.add('active');
        }

        // タブ切り替え時にデータを更新
        switch (tabId) {
            case 'memory':
                loadMemoryStats();
                break;
            case 'users':
                loadUsersData();
                break;
            case 'llm':
                loadLLMSettings();
                break;
            case 'discord':
                loadDiscordStatus();
                break;
            case 'logs':
                loadConversationList();
                break;
        }
    });
});

// ============================================================
// マスコットに戻る
// ============================================================

const backToMascotBtn = document.getElementById('back-to-mascot-btn');
if (backToMascotBtn) {
    backToMascotBtn.addEventListener('click', async () => {
        if ((window as any).electronAPI?.showMascot) {
            await (window as any).electronAPI.showMascot();
        }
    });
}

// ============================================================
// 記憶管理
// ============================================================

const memoryRefreshBtn = document.getElementById('memory-refresh-btn');
const memoryMaintenanceBtn = document.getElementById('memory-maintenance-btn');
const memoryClearBtn = document.getElementById('memory-clear-btn');
const memorySearchBtn = document.getElementById('memory-search-btn');
const memorySearchInput = document.getElementById('memory-search-input') as HTMLInputElement;
const memoryList = document.getElementById('memory-list');

async function loadMemoryStats(): Promise<void> {
    try {
        const stats = await (window as any).electronAPI.memoryStats();
        const count = await (window as any).electronAPI.memoryCount();

        document.getElementById('memory-count')!.textContent = String(count);
        document.getElementById('memory-facts')!.textContent = String(stats.byType?.fact || 0);
        document.getElementById('memory-episodes')!.textContent = String(stats.byType?.episode || 0);
        document.getElementById('memory-preferences')!.textContent = String(stats.byType?.preference || 0);

        // 全記憶を表示
        const memories = await (window as any).electronAPI.memoryGetAll();
        renderMemoryList(memories);
    } catch (error) {
        console.error('Failed to load memory stats:', error);
    }
}

function renderMemoryList(memories: any[]): void {
    if (!memoryList) return;

    if (memories.length === 0) {
        memoryList.innerHTML = '<p class="no-data">記憶がありません</p>';
        return;
    }

    memoryList.innerHTML = memories.map(mem => `
        <div class="memory-item" data-id="${mem.id}">
            <div class="memory-header">
                <span class="memory-type">${getTypeLabel(mem.metadata?.type)}</span>
                <span class="memory-importance">重要度: ${(mem.metadata?.importance * 100).toFixed(0)}%</span>
                ${mem.metadata?.discordUserId ? `<span class="memory-user">User: ${mem.metadata.discordUserId}</span>` : ''}
            </div>
            <div class="memory-content">${escapeHtml(mem.content)}</div>
            <div class="memory-meta">
                作成: ${formatDate(mem.createdAt)} |
                アクセス: ${mem.metadata?.accessCount || 0}回
                ${mem.metadata?.tags?.length ? ` | タグ: ${mem.metadata.tags.join(', ')}` : ''}
            </div>
        </div>
    `).join('');
}

function getTypeLabel(type: string): string {
    const labels: Record<string, string> = {
        fact: '📋 事実',
        episode: '📖 エピソード',
        skill: '🔧 スキル',
        preference: '❤️ 好み',
        relationship: '👥 関係',
    };
    return labels[type] || type;
}

memoryRefreshBtn?.addEventListener('click', loadMemoryStats);

memoryMaintenanceBtn?.addEventListener('click', async () => {
    if (!confirm('メンテナンスを実行しますか？\n古い記憶の圧縮や低重要度記憶の削除が行われます。')) return;

    try {
        const result = await (window as any).electronAPI.memoryMaintenance();
        alert(`メンテナンス完了:\n圧縮: ${result.compressed}件\n削除: ${result.forgotten}件`);
        await loadMemoryStats();
    } catch (error) {
        alert('メンテナンスに失敗しました');
        console.error(error);
    }
});

memoryClearBtn?.addEventListener('click', async () => {
    if (!confirm('本当にすべての記憶を削除しますか？\nこの操作は取り消せません。')) return;
    if (!confirm('最終確認: 全ての記憶が完全に削除されます。よろしいですか？')) return;

    try {
        await (window as any).electronAPI.memoryClear();
        alert('全ての記憶を削除しました');
        await loadMemoryStats();
    } catch (error) {
        alert('記憶の削除に失敗しました');
        console.error(error);
    }
});

memorySearchBtn?.addEventListener('click', async () => {
    const query = memorySearchInput?.value?.trim();
    if (!query) {
        await loadMemoryStats();
        return;
    }

    try {
        const results = await (window as any).electronAPI.memorySearch(query, 20);
        const memories = results.map((r: any) => ({
            ...r.entry,
            score: r.score
        }));
        renderMemoryList(memories);
    } catch (error) {
        console.error('Search failed:', error);
    }
});

memorySearchInput?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        memorySearchBtn?.click();
    }
});

// ============================================================
// ユーザー管理
// ============================================================

const usersRefreshBtn = document.getElementById('users-refresh-btn');
const usersList = document.getElementById('users-list');

async function loadUsersData(): Promise<void> {
    try {
        const stats = await (window as any).electronAPI.discordUsersStats();
        document.getElementById('users-total')!.textContent = String(stats?.totalUsers || 0);
        document.getElementById('users-named')!.textContent = String(stats?.namedUsers || 0);

        const users = await (window as any).electronAPI.discordUsersGetAll();
        renderUsersList(users || []);
    } catch (error) {
        console.error('Failed to load users:', error);
        document.getElementById('users-total')!.textContent = '0';
        document.getElementById('users-named')!.textContent = '0';
        if (usersList) {
            usersList.innerHTML = '<p class="no-data">ユーザーデータを取得できません</p>';
        }
    }
}

function renderUsersList(users: any[]): void {
    if (!usersList) return;

    if (users.length === 0) {
        usersList.innerHTML = '<p class="no-data">登録ユーザーがいません</p>';
        return;
    }

    usersList.innerHTML = users.map(user => `
        <div class="user-item">
            <div class="user-header">
                <span class="user-name">${escapeHtml(user.name || user.displayName || 'Unknown')}</span>
                <span class="user-id">ID: ${user.discordId}</span>
            </div>
            <div class="user-meta">
                メッセージ数: ${user.messageCount || 0} |
                初回: ${formatDate(user.firstSeen)} |
                最終: ${formatDate(user.lastSeen)}
            </div>
        </div>
    `).join('');
}

usersRefreshBtn?.addEventListener('click', loadUsersData);

// ============================================================
// LLM設定
// ============================================================

const llmProviderSelect = document.getElementById('llm-provider-select') as HTMLSelectElement;
const llmSaveBtn = document.getElementById('llm-save-btn');
const llmCurrentProvider = document.getElementById('llm-current-provider');

async function loadLLMSettings(): Promise<void> {
    try {
        const preference = await (window as any).electronAPI.getProviderPreference();
        if (llmProviderSelect && preference) {
            llmProviderSelect.value = preference;
        }
        if (llmCurrentProvider) {
            llmCurrentProvider.textContent = `現在の設定: ${preference}`;
        }
    } catch (error) {
        console.error('Failed to load LLM settings:', error);
    }
}

llmSaveBtn?.addEventListener('click', async () => {
    const value = llmProviderSelect?.value;
    if (!value) return;

    try {
        await (window as any).electronAPI.setProviderPreference(value);
        alert('LLM設定を保存しました');
        await loadLLMSettings();
    } catch (error) {
        alert('設定の保存に失敗しました');
        console.error(error);
    }
});

// ============================================================
// Discord状態
// ============================================================

const discordRefreshBtn = document.getElementById('discord-refresh-btn');
const discordStartBtn = document.getElementById('discord-start-btn');
const discordStopBtn = document.getElementById('discord-stop-btn');

async function loadDiscordStatus(): Promise<void> {
    try {
        const status = await (window as any).electronAPI.discordStatus();
        const botStatus = document.getElementById('discord-bot-status');
        if (botStatus) {
            botStatus.textContent = status.available ? status.state : '未設定';
            botStatus.className = `status-value ${status.state === 'ready' ? 'status-ok' : ''}`;
        }

        const voiceStatus = await (window as any).electronAPI.discordVoiceStatus();
        const voiceEl = document.getElementById('discord-voice-status');
        if (voiceEl) {
            voiceEl.textContent = voiceStatus.connected ? '接続中' : '未接続';
            voiceEl.className = `status-value ${voiceStatus.connected ? 'status-ok' : ''}`;
        }
    } catch (error) {
        console.error('Failed to load Discord status:', error);
    }
}

discordRefreshBtn?.addEventListener('click', loadDiscordStatus);

discordStartBtn?.addEventListener('click', async () => {
    try {
        await (window as any).electronAPI.discordStart();
        await loadDiscordStatus();
    } catch (error) {
        alert('Discord Botの開始に失敗しました');
        console.error(error);
    }
});

discordStopBtn?.addEventListener('click', async () => {
    try {
        await (window as any).electronAPI.discordStop();
        await loadDiscordStatus();
    } catch (error) {
        alert('Discord Botの停止に失敗しました');
        console.error(error);
    }
});

// ============================================================
// 会話ログ
// ============================================================

const logsRefreshBtn = document.getElementById('logs-refresh-btn');
const conversationListEl = document.getElementById('conversation-list');
const logsViewer = document.getElementById('logs-viewer');

async function loadConversationList(): Promise<void> {
    try {
        const conversations = await (window as any).electronAPI.conversationList();

        if (!conversationListEl) return;

        if (conversations.length === 0) {
            conversationListEl.innerHTML = '<li class="no-data">会話履歴がありません</li>';
            return;
        }

        conversationListEl.innerHTML = conversations.map((conv: any) => `
            <li class="conversation-item" data-id="${conv.id}">
                <span class="title">${escapeHtml(conv.title)}</span>
                <div class="meta">${formatDate(conv.updatedAt)} · ${conv.messageCount}件</div>
            </li>
        `).join('');

        // クリックイベント
        conversationListEl.querySelectorAll('.conversation-item').forEach(item => {
            item.addEventListener('click', () => {
                const id = (item as HTMLElement).dataset.id;
                if (id) {
                    loadConversationLog(id);
                    // アクティブ表示
                    conversationListEl.querySelectorAll('.conversation-item').forEach(i => i.classList.remove('active'));
                    item.classList.add('active');
                }
            });
        });
    } catch (error) {
        console.error('Failed to load conversations:', error);
    }
}

async function loadConversationLog(id: string): Promise<void> {
    if (!logsViewer) return;

    try {
        const conversation = await (window as any).electronAPI.conversationLoad(id);
        if (!conversation) {
            logsViewer.innerHTML = '<p class="error">会話を読み込めませんでした</p>';
            return;
        }

        logsViewer.innerHTML = `
            <div class="log-header">
                <h3>${escapeHtml(conversation.title)}</h3>
                <span>作成: ${formatDate(conversation.createdAt)}</span>
            </div>
            <div class="log-messages">
                ${conversation.messages.map((msg: any) => `
                    <div class="log-message ${msg.role}">
                        <div class="log-message-header">
                            <span class="role">${msg.role === 'user' ? '👤 ユーザー' : '🤖 AI'}</span>
                            ${msg.discordUserId ? `<span class="user-id">Discord: ${msg.discordUserId}</span>` : ''}
                            ${msg.displayName ? `<span class="display-name">${escapeHtml(msg.displayName)}</span>` : ''}
                            <span class="timestamp">${formatDate(msg.timestamp)}</span>
                        </div>
                        <div class="log-message-content">${escapeHtml(msg.content)}</div>
                    </div>
                `).join('')}
            </div>
        `;
    } catch (error) {
        console.error('Failed to load conversation:', error);
        logsViewer.innerHTML = '<p class="error">エラーが発生しました</p>';
    }
}

logsRefreshBtn?.addEventListener('click', loadConversationList);

// ============================================================
// ユーティリティ
// ============================================================

function escapeHtml(text: string): string {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatDate(timestamp: number): string {
    if (!timestamp) return '-';
    return new Date(timestamp).toLocaleString('ja-JP');
}

// ============================================================
// 初期化
// ============================================================

async function initialize(): Promise<void> {
    // 最初のタブ（記憶管理）のデータを読み込み
    await loadMemoryStats();
}

initialize();
