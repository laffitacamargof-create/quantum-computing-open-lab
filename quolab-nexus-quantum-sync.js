// ============================================================
// QUANTUM SYNC MODULE - VERSIÓN FINAL CORREGIDA
// ============================================================

class QuOLabNexusQuantumSync {
    constructor(config) {
        this.SUPABASE_URL = config.supabaseUrl;
        this.SUPABASE_ANON_KEY = config.supabaseAnonKey;
        
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
        this._onlineHandler = () => { if (!this._syncInProgress) this.init(); };
        window.addEventListener('online', this._onlineHandler);
        
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
            
            const testResponse = await this._fetchWithRetry(`${this.SUPABASE_URL}/rest/v1/${this.TABLES.PUBLISHED_APPS}?select=id&limit=1`, {
                method: 'GET',
                headers: {
                    'apikey': this.SUPABASE_ANON_KEY,
                    'Authorization': `Bearer ${this.SUPABASE_ANON_KEY}`
                }
            });
            
            if (!testResponse.ok) {
                console.warn(`⚠️ Supabase rechazó la clave pública o las políticas RLS: HTTP ${testResponse.status}`);
                this.isReady = false;
                this._startRetryPolling();
                return false;
            }
            
            console.log('✅ Conexión a Supabase establecida');
            await this.syncAll();
            
            this.isInitialized = true;
            this.isReady = true;
            console.log('✅ Quantum Sync Module initialized');
            
            this._startRetryPolling();
            
            return true;
        } catch (error) {
            console.error('❌ Error initializing Quantum Sync:', error.message);
            this.isReady = false;
            this._startRetryPolling();
            return false;
        }
    }

    _startRetryPolling() {
        if (this.syncInterval) return;
        this.syncInterval = setInterval(() => {
            if (navigator.onLine) {
                if (!this.isReady) this.init();
                else this.syncAll();
            }
        }, 15000);
    }

    async _fetchWithRetry(url, options = {}, attempts = 3) {
        let lastError;
        for (let attempt = 0; attempt < attempts; attempt++) {
            try {
                const response = await fetch(url, options);
                if (response.status < 500 && response.status !== 408 && response.status !== 429) return response;
                lastError = new Error('HTTP ' + response.status);
            } catch (error) { lastError = error; }
            if (attempt < attempts - 1) await new Promise(resolve => setTimeout(resolve, 800 * Math.pow(2, attempt)));
        }
        throw lastError || new Error('Network unavailable');
    }

    // ✅ CORREGIDO: SIN parámetro _ en URL
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
        
        const response = await this._fetchWithRetry(url, {
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

    async _rpc(name, body) {
        const response = await this._fetchWithRetry(`${this.SUPABASE_URL}/functions/v1/quolab-nexus-admin`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'apikey': this.SUPABASE_ANON_KEY,
                'Authorization': `Bearer ${this.SUPABASE_ANON_KEY}`
            },
            body: JSON.stringify({ action: name, params: body })
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
        return payload.data;
    }
    async _supabaseInsert(table, data) {
        console.log(`📤 Insertando en ${table}:`, {
            id: data.id,
            title: data.title,
            python_len: data.python_code?.length || 0,
            html_len: data.html_code?.length || 0
        });
        
        const response = await this._fetchWithRetry(`${this.SUPABASE_URL}/rest/v1/${table}`, {
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
        const response = await this._fetchWithRetry(`${this.SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`, {
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

    // Borrado verificado: Supabase responde 204 "OK" aunque la política (RLS) impida borrar y no se borre NADA.
    // Con Prefer: return=representation sabemos cuántas filas se borraron realmente.
    async _supabaseDelete(table, id) {
        const response = await this._fetchWithRetry(`${this.SUPABASE_URL}/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`, {
            method: 'DELETE',
            headers: {
                'apikey': this.SUPABASE_ANON_KEY,
                'Authorization': `Bearer ${this.SUPABASE_ANON_KEY}`,
                'Prefer': 'return=representation'
            }
        });
        if (!response.ok) {
            const t = await response.text();
            throw new Error(`HTTP ${response.status}: ${t}`);
        }
        let rows = [];
        try { rows = await response.json(); } catch (e) { rows = []; }
        if (!Array.isArray(rows) || rows.length === 0) {
            throw new Error('Supabase no borró nada: la tabla bloquea el DELETE (RLS) o el id no existe. ' +
                            'Instala la función SQL quantum_delete_app (ver comentario al final de quantum-sync.js) y guarda la llave de fundador.');
        }
        return true;
    }

    // Borrado administrativo centralizado en la Edge Function segura.
    async _adminDelete(tableKey, table, id) {
        const founderKey = localStorage.getItem('qcol_repo_founder_key') || '';
        if (!founderKey) throw new Error('Se requiere la llave de fundador');
        if (tableKey === 'pending') {
            await this._rpc('quantum_reject_app', { p_id: String(id), p_key: founderKey });
            return true;
        }
        if (tableKey === 'published') {
            await this._rpc('quantum_delete_published_app', { p_id: String(id), p_key: founderKey });
            return true;
        }
        throw new Error('Tipo de aplicación no permitido');
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
            const founderKey = localStorage.getItem('qcol_repo_founder_key') || '';
            if (!founderKey) { this.pendingApps = []; if (this.onPendingUpdate) this.onPendingUpdate(this.pendingApps); return this.pendingApps; }
            const data = await this._rpc('quantum_list_pending', { p_key: founderKey });
            this.pendingApps = data || [];
            if (this.onPendingUpdate) this.onPendingUpdate(this.pendingApps);
            return this.pendingApps;
        } catch (error) { console.error('Error syncing pending:', error.message); return []; }
    }

    async syncPublishedApps() {
        try {
            const data = await this._supabaseFetch(this.TABLES.PUBLISHED_APPS, {
                order: { column: 'created_at', direction: 'desc' }
            });
            this.publishedApps = data || [];
            try { localStorage.setItem('quolab_nexus_published_apps_cache', JSON.stringify(this.publishedApps)); } catch (e) {}
            if (this.onPublishedUpdate) this.onPublishedUpdate(this.publishedApps);
            return this.publishedApps;
        } catch (error) {
            console.error('Error syncing published:', error.message);
            try {
                const cached = JSON.parse(localStorage.getItem('quolab_nexus_published_apps_cache') || '[]');
                if (Array.isArray(cached)) {
                    this.publishedApps = cached;
                    if (this.onPublishedUpdate) this.onPublishedUpdate(this.publishedApps);
                    return this.publishedApps;
                }
            } catch (cacheError) {}
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
            const createdId = await this._rpc('quantum_submit_app', { p_app: pendingApp });
            pendingApp.id = createdId;
            console.log(`📤 App "${pendingApp.title}" submitted for approval`);
            return pendingApp;
        } catch (error) {
            console.error('Error submitting:', error.message);
            throw error;
        }
    }

    async approveApp(appId) {
        try {
            const founderKey = localStorage.getItem('qcol_repo_founder_key') || '';
            if (!founderKey) throw new Error('Se requiere la llave de fundador');
            const publishedApp = await this._rpc('quantum_approve_app', { p_id: String(appId), p_key: founderKey });
            await this.syncAll(true);
            if (this.onAppPublished) this.onAppPublished(publishedApp);
            return publishedApp;
        } catch (error) { console.error('Error approving:', error.message); throw error; }
    }

    async rejectApp(appId) {
        try {
            const founderKey = localStorage.getItem('qcol_repo_founder_key') || '';
            if (!founderKey) throw new Error('Se requiere la llave de fundador');
            await this._rpc('quantum_reject_app', { p_id: String(appId), p_key: founderKey });
            await this.syncPendingApps();
            if (this.onAppRejected) this.onAppRejected(appId);
            return true;
        } catch (error) { console.error('Error rejecting:', error.message); throw error; }
    }

    async deletePublishedApp(appId) {
        try {
            const founderKey = localStorage.getItem('qcol_repo_founder_key') || '';
            if (!founderKey) throw new Error('Se requiere la llave de fundador');
            await this._rpc('quantum_delete_published_app', { p_id: String(appId), p_key: founderKey });
            await this.syncPublishedApps();
            return true;
        } catch (error) { console.error('Error deleting:', error.message); throw error; }
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
        if (this._onlineHandler) window.removeEventListener('online', this._onlineHandler);
    }
}

export default QuOLabNexusQuantumSync;

/* ============================================================================
   SQL PARA SUPABASE (ejecutar UNA vez en SQL Editor) — permite borrar apps solo con la llave de fundador
   ----------------------------------------------------------------------------
   create or replace function public.quantum_delete_app(p_table text, p_id text, p_key text)
   returns boolean language plpgsql security definer set search_path = public as $$
   declare n int;
   begin
     if not public.repo_is_founder(p_key) then raise exception 'forbidden'; end if;
     if p_table = 'published' then delete from public.quantum_published_apps where id::text = p_id;
     elsif p_table = 'pending' then delete from public.quantum_pending_apps where id::text = p_id;
     else raise exception 'bad table'; end if;
     get diagnostics n = row_count;
     return n > 0;
   end $$;
   grant execute on function public.quantum_delete_app(text, text, text) to anon;
   ============================================================================ */
