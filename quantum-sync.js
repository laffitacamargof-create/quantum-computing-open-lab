// ============================================================
// QUANTUM SYNC MODULE - VERSIÓN SIMPLIFICADA
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
        
        this.onPendingUpdate = null;
        this.onPublishedUpdate = null;
        this.onAppPublished = null;
        this.onAppRejected = null;
    }

    async init() {
        try {
            console.log('🔌 Probando conexión a Supabase...');
            console.log('📌 URL:', this.SUPABASE_URL);
            
            // Probar conexión directamente a la tabla
            const testResponse = await fetch(`${this.SUPABASE_URL}/rest/v1/${this.TABLES.PENDING_APPS}?select=id&limit=1`, {
                method: 'GET',
                headers: {
                    'apikey': this.SUPABASE_ANON_KEY,
                    'Authorization': `Bearer ${this.SUPABASE_ANON_KEY}`
                }
            });
            
            if (testResponse.status === 401) {
                console.log('🔄 Intentando con service_role...');
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
            
            this.syncInterval = setInterval(() => this.syncAll(), 30000);
            return true;
        } catch (error) {
            console.error('❌ Error initializing Quantum Sync:', error.message);
            this.isReady = false;
            return false;
        }
    }

    async _supabaseFetch(table, options = {}) {
        const url = new URL(`${this.SUPABASE_URL}/rest/v1/${table}`);
        if (options.select) url.searchParams.append('select', options.select);
        if (options.eq) {
            Object.entries(options.eq).forEach(([key, value]) => {
                url.searchParams.append(key, `eq.${value}`);
            });
        }
        if (options.order) {
            url.searchParams.append('order', `${options.order.column}.${options.order.direction || 'asc'}`);
        }
        
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'apikey': this.SUPABASE_ANON_KEY,
                'Authorization': `Bearer ${this.SUPABASE_ANON_KEY}`
            }
        });
        
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.json();
    }

    async _supabaseInsert(table, data) {
        const response = await fetch(`${this.SUPABASE_URL}/rest/v1/${table}`, {
            method: 'POST',
            headers: {
                'apikey': this.SUPABASE_ANON_KEY,
                'Authorization': `Bearer ${this.SUPABASE_ANON_KEY}`,
                'Prefer': 'return=representation'
            },
            body: JSON.stringify(data)
        });
        
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
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

    async syncAll() {
        await this.syncPendingApps();
        await this.syncPublishedApps();
    }

    async syncPendingApps() {
        try {
            const data = await this._supabaseFetch(this.TABLES.PENDING_APPS, {
                select: '*',
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
                select: '*',
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
        const pendingApp = {
            id: appData.id || this._generateId(),
            name: appData.name || appData.title || 'Untitled',
            title: appData.title || appData.name || 'Untitled',
            description: appData.description || '',
            tags: appData.tags || '',
            duration: appData.duration || 8,
            python_code: appData.pythonCode || '',
            html_code: appData.htmlCode || '',
            server_url: appData.serverUrl || '',
            created_by: this.currentUser?.id || 'anonymous',
            created_at: new Date().toISOString(),
            submitted_by: this.currentUser?.id || 'anonymous',
            submitted_at: new Date().toISOString(),
            status: 'pending'
        };
        
        try {
            const existing = await this._supabaseFetch(this.TABLES.PENDING_APPS, {
                select: 'id',
                eq: { id: pendingApp.id }
            });
            
            if (existing && existing.length > 0) {
                const response = await fetch(`${this.SUPABASE_URL}/rest/v1/${this.TABLES.PENDING_APPS}?id=eq.${pendingApp.id}`, {
                    method: 'PATCH',
                    headers: {
                        'Content-Type': 'application/json',
                        'apikey': this.SUPABASE_ANON_KEY,
                        'Authorization': `Bearer ${this.SUPABASE_ANON_KEY}`
                    },
                    body: JSON.stringify(pendingApp)
                });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
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
            const pendingApps = await this._supabaseFetch(this.TABLES.PENDING_APPS, {
                select: '*',
                eq: { id: appId }
            });
            
            if (!pendingApps || pendingApps.length === 0) {
                throw new Error('App not found');
            }
            
            const pendingApp = pendingApps[0];
            const publishedApp = {
                id: pendingApp.id,
                name: pendingApp.name,
                title: pendingApp.title,
                description: pendingApp.description,
                tags: pendingApp.tags,
                duration: pendingApp.duration,
                python_code: pendingApp.python_code,
                html_code: pendingApp.html_code,
                server_url: pendingApp.server_url,
                created_by: pendingApp.created_by,
                created_at: pendingApp.created_at,
                published_by: this.currentUser?.id || 'admin',
                published_at: new Date().toISOString(),
                version: 1,
                is_active: true
            };
            
            await this._supabaseInsert(this.TABLES.PUBLISHED_APPS, publishedApp);
            await this._supabaseDelete(this.TABLES.PENDING_APPS, appId);
            await this.syncAll();
            
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