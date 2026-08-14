// ============================================================
// QUANTUM SYNC MODULE - CORREGIDO
// ============================================================

class QuantumSync {
    constructor(config) {
        this.SUPABASE_URL = config.supabaseUrl;
        this.SUPABASE_ANON_KEY = config.supabaseAnonKey;
        this.SUPABASE_SERVICE_KEY = config.supabaseServiceKey;
        
        this.TABLES = {
            PENDING_APPS: 'quantum_pending_apps',
            PUBLISHED_APPS: 'quantum_published_apps'
        };
        
        this.isInitialized = false;
        this.isReady = false;
        this.currentUser = null;
        this.userRole = 'user';
        this.syncInterval = null;
        this.pendingApps = [];
        this.publishedApps = [];
        this._syncInProgress = false;
        this._lastSync = 0;
        
        this.onPendingUpdate = null;
        this.onPublishedUpdate = null;
        this.onAppPublished = null;
        this.onAppRejected = null;
        this.onSyncComplete = null;
    }

    async init() {
        try {
            console.log('🔌 Probando conexión a Supabase...');
            console.log('📌 URL:', this.SUPABASE_URL);
            
            const testResponse = await fetch(`${this.SUPABASE_URL}/rest/v1/${this.TABLES.PENDING_APPS}?select=id&limit=1`, {
                method: 'GET',
                headers: {
                    'apikey': this.SUPABASE_ANON_KEY,
                    'Authorization': `Bearer ${this.SUPABASE_ANON_KEY}`
                }
            });
            
            if (testResponse.status === 401) {
                const testResponse2 = await fetch(`${this.SUPABASE_URL}/rest/v1/${this.TABLES.PENDING_APPS}?select=id&limit=1`, {
                    method: 'GET',
                    headers: {
                        'apikey': this.SUPABASE_SERVICE_KEY,
                        'Authorization': `Bearer ${this.SUPABASE_SERVICE_KEY}`
                    }
                });
                if (!testResponse2.ok) {
                    console.warn(`⚠️ Error de conexión: HTTP ${testResponse2.status}`);
                    this.isReady = false;
                    return false;
                }
            } else if (!testResponse.ok) {
                console.warn(`⚠️ Error de conexión: HTTP ${testResponse.status}`);
                this.isReady = false;
                return false;
            }
            
            console.log('✅ Conexión a Supabase establecida');
            await this.syncAll();
            
            this.isInitialized = true;
            this.isReady = true;
            console.log('✅ Quantum Sync Module initialized');
            
            this.syncInterval = setInterval(() => {
                this.syncAll();
                if (this.onSyncComplete) this.onSyncComplete();
            }, 10000);
            
            return true;
        } catch (error) {
            console.error('❌ Error initializing Quantum Sync:', error.message);
            this.isReady = false;
            return false;
        }
    }

    // ✅ CORREGIDO: Sin parámetro _ en URL
    async _supabaseFetch(table, options = {}) {
        let url = `${this.SUPABASE_URL}/rest/v1/${table}?select=*`;
        
        if (options.eq) {
            Object.entries(options.eq).forEach(([key, value]) => {
                url += `&${key}=eq.${value}`;
            });
        }
        
        if (options.order) {
            url += `&order=${options.order.column}.${options.order.direction || 'asc'}`;
        }
        
        if (options.limit) {
            url += `&limit=${options.limit}`;
        }
        
        console.log('📡 Fetch:', url);
        
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'apikey': this.SUPABASE_ANON_KEY,
                'Authorization': `Bearer ${this.SUPABASE_ANON_KEY}`,
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Pragma': 'no-cache'
            }
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`HTTP ${response.status}: ${errorText}`);
        }
        return await response.json();
    }

    async _supabaseInsert(table, data) {
        console.log(`📤 Insertando en ${table}:`, {
            id: data.id,
            title: data.title,
            python_len: data.python_code?.length || 0,
            html_len: data.html_code?.length || 0
        });
        
        const response = await fetch(`${this.SUPABASE_URL}/rest/v1/${table}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'apikey': this.SUPABASE_ANON_KEY,
                'Authorization': `Bearer ${this.SUPABASE_ANON_KEY}`,
                'Prefer': 'return=representation'
            },
            body: JSON.stringify(data)
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`HTTP ${response.status}: ${errorText}`);
        }
        return await response.json();
    }

    async _supabaseUpdate(table, id, data) {
        const response = await fetch(`${this.SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                'apikey': this.SUPABASE_ANON_KEY,
                'Authorization': `Bearer ${this.SUPABASE_ANON_KEY}`,
                'Prefer': 'return=representation'
            },
            body: JSON.stringify(data)
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`HTTP ${response.status}: ${errorText}`);
        }
        return await response.json();
    }

    async _supabaseDelete(table, id) {
        const response = await fetch(`${this.SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`, {
            method: 'DELETE',
            headers: {
                'apikey': this.SUPABASE_ANON_KEY,
                'Authorization': `Bearer ${this.SUPABASE_ANON_KEY}`
            }
        });
        
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return true;
    }

    async syncAll(force = false) {
        if (this._syncInProgress && !force) return;
        this._syncInProgress = true;
        try {
            await this.syncPendingApps();
            await this.syncPublishedApps();
            this._lastSync = Date.now();
            if (this.onSyncComplete) this.onSyncComplete();
        } catch (error) {
            console.error('Sync error:', error.message);
        } finally {
            this._syncInProgress = false;
        }
    }

    async syncPendingApps() {
        try {
            const data = await this._supabaseFetch(this.TABLES.PENDING_APPS, {
                order: { column: 'created_at', direction: 'desc' }
            });
            this.pendingApps = data || [];
            if (this.onPendingUpdate) this.onPendingUpdate(this.pendingApps);
            return this.pendingApps;
        } catch (error) {
            console.error('Error syncing pending:', error.message);
            return [];
        }
    }

    async syncPublishedApps() {
        try {
            const data = await this._supabaseFetch(this.TABLES.PUBLISHED_APPS, {
                order: { column: 'created_at', direction: 'desc' }
            });
            this.publishedApps = data || [];
            if (this.onPublishedUpdate) this.onPublishedUpdate(this.publishedApps);
            return this.publishedApps;
        } catch (error) {
            console.error('Error syncing published:', error.message);
            return [];
        }
    }

    async submitApp(appData) {
        const id = appData.id || this._generateId();
        const name = (appData.name || appData.title || 'Untitled').substring(0, 100);
        const title = (appData.title || appData.name || 'Untitled').substring(0, 100);
        const description = (appData.description || '').substring(0, 500);
        const tags = (appData.tags || '');
        const duration = parseInt(appData.duration) || 8;
        const pythonCode = appData.pythonCode || appData.python_code || '';
        const htmlCode = appData.htmlCode || appData.html_code || '';
        const serverUrl = appData.serverUrl || '';
        
        const pendingApp = {
            id: id,
            name: name,
            title: title,
            description: description,
            tags: tags,
            duration: duration,
            python_code: pythonCode,
            html_code: htmlCode,
            server_url: serverUrl,
            created_by: this.currentUser?.id || 'anonymous',
            created_at: new Date().toISOString(),
            submitted_by: this.currentUser?.id || 'anonymous',
            submitted_at: new Date().toISOString(),
            status: 'pending'
        };
        
        console.log('📤 Enviando app a pending:', {
            id: pendingApp.id,
            title: pendingApp.title,
            python_len: pendingApp.python_code.length,
            html_len: pendingApp.html_code.length
        });
        
        try {
            const existing = await this._supabaseFetch(this.TABLES.PENDING_APPS, {
                eq: { id: pendingApp.id }
            });
            
            if (existing && existing.length > 0) {
                await this._supabaseUpdate(this.TABLES.PENDING_APPS, pendingApp.id, pendingApp);
            } else {
                await this._supabaseInsert(this.TABLES.PENDING_APPS, pendingApp);
            }
            
            await this.syncPendingApps();
            console.log(`📤 App "${pendingApp.title}" submitted for approval`);
            return pendingApp;
        } catch (error) {
            console.error('Error submitting:', error.message);
            throw error;
        }
    }

    async approveApp(appId) {
        try {
            console.log(`📤 Aprobando app: ${appId}`);
            
            const pendingApps = await this._supabaseFetch(this.TABLES.PENDING_APPS, {
                eq: { id: appId }
            });
            
            if (!pendingApps || pendingApps.length === 0) {
                throw new Error('App not found');
            }
            
            const pendingApp = pendingApps[0];
            
            const publishedApp = {
                id: pendingApp.id,
                name: pendingApp.name || pendingApp.title || 'Untitled',
                title: pendingApp.title || pendingApp.name || 'Untitled',
                description: pendingApp.description || '',
                tags: pendingApp.tags || '',
                duration: parseInt(pendingApp.duration) || 8,
                python_code: pendingApp.python_code || pendingApp.pythonCode || '',
                html_code: pendingApp.html_code || pendingApp.htmlCode || '',
                server_url: pendingApp.server_url || '',
                created_by: pendingApp.created_by || 'anonymous',
                created_at: pendingApp.created_at || new Date().toISOString(),
                published_by: this.currentUser?.id || 'admin',
                published_at: new Date().toISOString(),
                version: 1,
                is_active: true
            };
            
            console.log('📤 Publicando app:', {
                title: publishedApp.title,
                python_len: publishedApp.python_code?.length || 0,
                html_len: publishedApp.html_code?.length || 0
            });
            
            await this._supabaseInsert(this.TABLES.PUBLISHED_APPS, publishedApp);
            await this._supabaseDelete(this.TABLES.PENDING_APPS, appId);
            await this.syncAll(true);
            
            if (this.onAppPublished) this.onAppPublished(publishedApp);
            console.log(`✅ App "${pendingApp.title}" published!`);
            return publishedApp;
        } catch (error) {
            console.error('Error approving:', error.message);
            throw error;
        }
    }

    async rejectApp(appId) {
        try {
            await this._supabaseDelete(this.TABLES.PENDING_APPS, appId);
            await this.syncPendingApps();
            if (this.onAppRejected) this.onAppRejected(appId);
            console.log(`🗑️ App rejected`);
            return true;
        } catch (error) {
            console.error('Error rejecting:', error.message);
            throw error;
        }
    }

    async deletePublishedApp(appId) {
        try {
            await this._supabaseDelete(this.TABLES.PUBLISHED_APPS, appId);
            await this.syncPublishedApps();
            return true;
        } catch (error) {
            console.error('Error deleting:', error.message);
            throw error;
        }
    }

    _generateId() {
        return Date.now() + '-' + Math.random().toString(36).substring(2, 10);
    }

    setUser(user) {
        this.currentUser = user;
        this.userRole = user?.role || 'user';
    }

    connectPuzzle() {
        console.log('🔗 Puzzle conectado');
    }

    connectStudio(iframe) {
        console.log('🔗 Studio conectado');
    }

    destroy() {
        if (this.syncInterval) {
            clearInterval(this.syncInterval);
            this.syncInterval = null;
        }
    }
}

export default QuantumSync;