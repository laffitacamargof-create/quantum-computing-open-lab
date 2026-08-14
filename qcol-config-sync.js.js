// ============================================================
// QCOL CONFIG SYNC - Sincronización de configuración en la nube
// ============================================================

class QcolConfigSync {
    constructor(config) {
        this.SUPABASE_URL = config.supabaseUrl;
        this.SUPABASE_ANON_KEY = config.supabaseAnonKey;
        this.SUPABASE_SERVICE_KEY = config.supabaseServiceKey;
        
        this.isReady = false;
        this.currentUser = null;
        this.configCache = {};
        this.syncInterval = null;
        this._syncInProgress = false;
        
        // Callbacks
        this.onConfigUpdate = null;
        this.onSyncComplete = null;
    }

    // ==================== INICIALIZACIÓN ====================
    
    async init() {
        try {
            console.log('🔌 Config Sync: Probando conexión...');
            
            const testResponse = await fetch(`${this.SUPABASE_URL}/rest/v1/quantum_ecosystem_config?select=key&limit=1`, {
                method: 'GET',
                headers: {
                    'apikey': this.SUPABASE_ANON_KEY,
                    'Authorization': `Bearer ${this.SUPABASE_ANON_KEY}`
                }
            });
            
            if (!testResponse.ok && testResponse.status !== 404) {
                console.warn('⚠️ Config Sync: Error de conexión');
                this.isReady = false;
                return false;
            }
            
            console.log('✅ Config Sync: Conexión establecida');
            await this.syncAll();
            
            this.isReady = true;
            console.log('✅ Config Sync inicializado');
            
            this.syncInterval = setInterval(() => this.syncAll(), 15000);
            
            return true;
        } catch (error) {
            console.error('❌ Config Sync error:', error.message);
            this.isReady = false;
            return false;
        }
    }

    // ==================== FUNCIONES BASE ====================
    
    async _fetch(table, options = {}) {
        let url = `${this.SUPABASE_URL}/rest/v1/${table}?select=*`;
        
        if (options.eq) {
            Object.entries(options.eq).forEach(([key, value]) => {
                url += `&${key}=eq.${value}`;
            });
        }
        
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'apikey': this.SUPABASE_ANON_KEY,
                'Authorization': `Bearer ${this.SUPABASE_ANON_KEY}`
            }
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        return await response.json();
    }

    async _insert(table, data) {
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
            throw new Error(`HTTP ${response.status}`);
        }
        return await response.json();
    }

    async _update(table, key, data) {
        const response = await fetch(`${this.SUPABASE_URL}/rest/v1/${table}?key=eq.${key}`, {
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
            throw new Error(`HTTP ${response.status}`);
        }
        return await response.json();
    }

    // ==================== SINCRONIZACIÓN ====================
    
    async syncAll() {
        if (this._syncInProgress) return;
        this._syncInProgress = true;
        try {
            await this._syncConfig('colab_url', 'qcol_colab_url');
            await this._syncConfig('ai_config', 'qcol_ai');
            await this._syncConfig('github_config', 'qcol_gh');
            await this._syncConfig('deepseek_config', 'qcol_mistral');
            await this._syncConfig('system_config', 'qcol_sys');
            await this._syncConfig('platform_config', 'qcol_cfg');
            await this._syncConfig('monitor_config', 'qcol_monitor_cfg');
            
            if (this.onSyncComplete) this.onSyncComplete();
        } catch (error) {
            console.error('Config Sync error:', error.message);
        } finally {
            this._syncInProgress = false;
        }
    }

    async _syncConfig(cloudKey, localKey) {
        try {
            // 1. Obtener valor de la nube
            const cloudData = await this._fetch('quantum_ecosystem_config', {
                eq: { key: cloudKey }
            });
            
            let cloudValue = null;
            if (cloudData && cloudData.length > 0) {
                cloudValue = cloudData[0].value;
                // Intentar parsear JSON
                try { cloudValue = JSON.parse(cloudValue); } catch(e) {}
            }
            
            // 2. Obtener valor local
            let localValue = localStorage.getItem(localKey);
            try { localValue = JSON.parse(localValue); } catch(e) {}
            
            // 3. Determinar cuál es más reciente (comparar timestamps)
            const cloudTimestamp = cloudData && cloudData.length > 0 ? new Date(cloudData[0].updated_at) : null;
            const localTimestamp = localStorage.getItem(localKey + '_timestamp');
            const localTime = localTimestamp ? new Date(localTimestamp) : null;
            
            // 4. Sincronizar: si la nube tiene valor y es más reciente, actualizar local
            if (cloudValue !== null && cloudValue !== undefined) {
                if (!localValue || (cloudTimestamp && localTime && cloudTimestamp > localTime)) {
                    // Nube más reciente → actualizar local
                    localStorage.setItem(localKey, JSON.stringify(cloudValue));
                    localStorage.setItem(localKey + '_timestamp', new Date().toISOString());
                    console.log(`📥 Config ${cloudKey} actualizada desde la nube`);
                    if (this.onConfigUpdate) this.onConfigUpdate(cloudKey, cloudValue);
                } else if (localValue && (!cloudTimestamp || !localTime || localTime > cloudTimestamp)) {
                    // Local más reciente → actualizar nube
                    await this._updateOrInsert(cloudKey, localValue);
                    console.log(`📤 Config ${cloudKey} subida a la nube`);
                }
            } else if (localValue !== null && localValue !== undefined) {
                // Solo local → subir a la nube
                await this._updateOrInsert(cloudKey, localValue);
                console.log(`📤 Config ${cloudKey} subida a la nube (nueva)`);
            }
        } catch (error) {
            console.warn(`⚠️ Error sincronizando ${cloudKey}:`, error.message);
        }
    }

    async _updateOrInsert(key, value) {
        const stringValue = typeof value === 'string' ? value : JSON.stringify(value);
        const data = {
            id: 'cfg-' + key,
            key: key,
            value: stringValue,
            updated_by: this.currentUser?.id || 'anonymous',
            updated_at: new Date().toISOString()
        };
        
        try {
            // Verificar si existe
            const existing = await this._fetch('quantum_ecosystem_config', {
                eq: { key: key }
            });
            
            if (existing && existing.length > 0) {
                await this._update('quantum_ecosystem_config', key, data);
            } else {
                data.created_at = new Date().toISOString();
                await this._insert('quantum_ecosystem_config', data);
            }
        } catch (error) {
            console.error('Error updating config:', error);
            throw error;
        }
    }

    // ==================== OBTENER CONFIGURACIÓN ====================
    
    getConfig(key) {
        const localKey = this._getLocalKey(key);
        const value = localStorage.getItem(localKey);
        if (value) {
            try { return JSON.parse(value); } catch(e) { return value; }
        }
        return null;
    }

    setConfig(key, value) {
        const localKey = this._getLocalKey(key);
        localStorage.setItem(localKey, typeof value === 'string' ? value : JSON.stringify(value));
        localStorage.setItem(localKey + '_timestamp', new Date().toISOString());
        
        // Si estamos conectados, sincronizar inmediatamente
        if (this.isReady) {
            setTimeout(() => this._syncConfig(key, localKey), 500);
        }
    }

    _getLocalKey(cloudKey) {
        const map = {
            'colab_url': 'qcol_colab_url',
            'ai_config': 'qcol_ai',
            'github_config': 'qcol_gh',
            'deepseek_config': 'qcol_mistral',
            'system_config': 'qcol_sys',
            'platform_config': 'qcol_cfg',
            'monitor_config': 'qcol_monitor_cfg'
        };
        return map[cloudKey] || cloudKey;
    }

    setUser(user) {
        this.currentUser = user;
    }

    destroy() {
        if (this.syncInterval) {
            clearInterval(this.syncInterval);
            this.syncInterval = null;
        }
    }
}

export default QcolConfigSync;