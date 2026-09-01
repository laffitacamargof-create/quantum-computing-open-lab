// ================================================================
// CONFIGURACIÓN GENERAL - TODOS LOS NEGOCIOS
// ================================================================

const CONFIG_NEGOCIOS = {
    "mi-primer-negocio": {
        nombre: "mi primer negocio",
        password: "123",
        tipo: "piso",
        supabase: {
            url: "https://fxtioitrdtahmljclyqv.supabase.co/rest/v1/",
            anonKey: "sb_publishable_xRP_-tiKCzIMmdGEAjNSwQ_YGsI3Q8T",
            // ✅ NUEVA SERVICE ROLE KEY
            serviceKey: "sb_secret_z11YVABuL0LESSbktFtRZA_J-_W8XMv"
        },
        tablas: [
            "um",
            "config",
            "departamentos",
            "familias",
            "productos",
            "cartastecnicas",
            "cartastecnicas_detalle",
            "cartastecnicas_visual",
            "mermas",
            "mermas_detalle",
            "otrosgastos",
            "razongastos",
            "recepciones",
            "recepciones_detalle",
            "redcajas",
            "temp",
            "temp2",
            "transferencias",
            "transferencias_detalle",
            "ventas",
            "ventas_detalle"
        ]
    }
};

function obtenerConfigNegocio(nombreNegocio) {
    var keys = Object.keys(CONFIG_NEGOCIOS);
    for (var i = 0; i < keys.length; i++) {
        var key = keys[i];
        if (CONFIG_NEGOCIOS[key].nombre.toLowerCase() === nombreNegocio.toLowerCase()) {
            return {
                key: key,
                config: CONFIG_NEGOCIOS[key]
            };
        }
    }
    return null;
}

function obtenerNombresNegocios() {
    var nombres = [];
    var keys = Object.keys(CONFIG_NEGOCIOS);
    for (var i = 0; i < keys.length; i++) {
        nombres.push(CONFIG_NEGOCIOS[keys[i]].nombre);
    }
    return nombres;
}