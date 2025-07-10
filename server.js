// Backend FullStack Railway: WebSocket + API + Frontend + DB
const WebSocket = require('ws');
const express = require('express');
const cors = require('cors');
const path = require('path');

// Configurar Express para API REST + Frontend
const app = express();
app.use(cors());
app.use(express.json());

// Configurar PostgreSQL para Railway (automático si está disponible)
let pool = null;
if (process.env.DATABASE_URL) {
  const { Pool } = require('pg');
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  });
  console.log('✅ PostgreSQL conectado via DATABASE_URL');
}

// Puerto dinámico para Railway
const HTTP_PORT = process.env.PORT || 3000;
const WS_PORT = process.env.WS_PORT || (HTTP_PORT + 1);

// WebSocket Server
let wss;
let clients = [];

// Base de datos en memoria (backup si no hay PostgreSQL)
let ejerciciosDB = [];
let nextId = 1;

// === SERVIR FRONTEND REACT ===
app.use(express.static(path.join(__dirname, 'public')));

// === WEBSOCKET ===
function initWebSocket() {
  try {
    wss = new WebSocket.Server({ port: WS_PORT });
    console.log(`📡 WebSocket iniciado en puerto ${WS_PORT}`);
    
    wss.on('connection', (ws) => {
      console.log('🌐 WebApp conectada');
      clients.push(ws);
      
      ws.send('WEB_BLUETOOTH_READY');
      
      ws.on('message', (data) => {
        const message = data.toString();
        console.log('📱 Estado webapp:', message);
        
        if (message.startsWith('BLUETOOTH_CONNECTED')) {
          console.log('✅ Arduino conectado vía Web Bluetooth');
        }
        
        if (message.startsWith('EJERCICIO_INICIADO')) {
          console.log('🏃 Ejercicio iniciado:', message);
        }

        if (message.startsWith('EJERCICIO_COMPLETADO')) {
          console.log('🎯 Ejercicio completado:', message);
          
          try {
            const parts = message.split(':');
            if (parts.length >= 5) {
              const ejercicioData = {
                id: nextId++,
                fecha: new Date().toISOString(),
                ejercicio: parts[1],
                objetivo: parseInt(parts[2]),
                completado: parseInt(parts[3]),
                duracion: parseInt(parts[4]),
                dispositivo: 'Arduino-BLE'
              };
              
              if (pool) {
                guardarEjercicioDB(ejercicioData);
              } else {
                guardarEjercicioMemoria(ejercicioData);
              }
            }
          } catch (err) {
            console.error('❌ Error procesando ejercicio:', err);
          }
        }
        
        clients.forEach(client => {
          if (client !== ws && client.readyState === WebSocket.OPEN) {
            client.send(message);
          }
        });
      });
      
      ws.on('close', () => {
        console.log('🌐 WebApp desconectada');
        clients = clients.filter(client => client !== ws);
      });
    });
  } catch (err) {
    console.log('⚠️ WebSocket no pudo iniciarse en puerto', WS_PORT, '- continuando sin WebSocket');
  }
}

// Función para guardar en PostgreSQL
async function guardarEjercicioDB(ejercicioData) {
  try {
    const query = `
      INSERT INTO ejercicios (ejercicio, objetivo, completado, duracion, dispositivo, fecha)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `;
    
    const values = [
      ejercicioData.ejercicio,
      ejercicioData.objetivo,
      ejercicioData.completado,
      ejercicioData.duracion,
      ejercicioData.dispositivo,
      ejercicioData.fecha
    ];

    const result = await pool.query(query, values);
    console.log('💾 Ejercicio guardado en PostgreSQL:', result.rows[0]);
    
    const notificacion = `EJERCICIO_GUARDADO:${JSON.stringify(result.rows[0])}`;
    clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(notificacion);
      }
    });
    
  } catch (err) {
    console.error('❌ Error guardando en PostgreSQL:', err);
    guardarEjercicioMemoria(ejercicioData);
  }
}

// Función para guardar en memoria
function guardarEjercicioMemoria(ejercicioData) {
  try {
    ejerciciosDB.push(ejercicioData);
    console.log('💾 Ejercicio guardado en memoria:', ejercicioData);
    
    const notificacion = `EJERCICIO_GUARDADO:${JSON.stringify(ejercicioData)}`;
    clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(notificacion);
      }
    });
    
  } catch (err) {
    console.error('❌ Error guardando ejercicio en memoria:', err);
  }
}

// Inicializar tabla PostgreSQL
async function initDatabase() {
  if (!pool) return;
  
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS ejercicios (
      id SERIAL PRIMARY KEY,
      fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      ejercicio VARCHAR(50) NOT NULL,
      objetivo INTEGER NOT NULL,
      completado INTEGER NOT NULL,
      duracion INTEGER,
      dispositivo VARCHAR(100) DEFAULT 'Arduino'
    );
  `;
  
  try {
    await pool.query(createTableQuery);
    console.log('✅ Tabla ejercicios creada/verificada');
  } catch (err) {
    console.error('❌ Error creando tabla:', err);
  }
}

// === API REST ===

app.get('/api', (req, res) => {
  res.json({ 
    message: 'Fitness Arduino FullStack API', 
    status: 'active',
    frontend: 'React servido estáticamente',
    backend: 'Node.js + WebSocket',
    database: pool ? 'PostgreSQL' : 'Memoria RAM',
    websocket_port: WS_PORT,
    http_port: HTTP_PORT,
    endpoints: [
      'GET / - Frontend React',
      'POST /api/ejercicio - Guardar ejercicio',
      'GET /api/historial - Ver historial', 
      'GET /api/estadisticas - Estadísticas'
    ]
  });
});

app.post('/api/ejercicio', async (req, res) => {
  try {
    const { ejercicio, objetivo, completado, duracion, dispositivo, datos_extra } = req.body;

    if (!ejercicio || !objetivo || completado === undefined) {
      return res.status(400).json({
        error: 'Faltan campos requeridos'
      });
    }

    const nuevoEjercicio = {
      ejercicio: ejercicio.toUpperCase(),
      objetivo: objetivo,
      completado: completado,
      duracion: duracion || null,
      dispositivo: dispositivo || 'Arduino',
      fecha: new Date().toISOString()
    };

    if (pool) {
      const query = `
        INSERT INTO ejercicios (ejercicio, objetivo, completado, duracion, dispositivo, fecha)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
      `;
      
      const values = [
        nuevoEjercicio.ejercicio,
        nuevoEjercicio.objetivo,
        nuevoEjercicio.completado,
        nuevoEjercicio.duracion,
        nuevoEjercicio.dispositivo,
        nuevoEjercicio.fecha
      ];

      const result = await pool.query(query, values);
      res.json({ success: true, data: result.rows[0] });
    } else {
      nuevoEjercicio.id = nextId++;
      ejerciciosDB.push(nuevoEjercicio);
      res.json({ success: true, data: nuevoEjercicio });
    }

  } catch (err) {
    console.error('❌ Error guardando ejercicio via API:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

app.get('/api/historial', async (req, res) => {
  try {
    const { limit = 20 } = req.query;
    
    if (pool) {
      const result = await pool.query(
        'SELECT * FROM ejercicios ORDER BY fecha DESC LIMIT $1',
        [parseInt(limit)]
      );
      
      res.json({
        success: true,
        data: result.rows,
        source: 'PostgreSQL'
      });
    } else {
      const historial = ejerciciosDB
        .sort((a, b) => new Date(b.fecha) - new Date(a.fecha))
        .slice(0, parseInt(limit));

      res.json({
        success: true,
        data: historial,
        source: 'Memoria'
      });
    }

  } catch (err) {
    console.error('❌ Error obteniendo historial:', err);
    res.status(500).json({ error: 'Error obteniendo historial' });
  }
});

app.get('/api/estadisticas', async (req, res) => {
  try {
    let ejercicios = [];
    
    if (pool) {
      const result = await pool.query('SELECT * FROM ejercicios');
      ejercicios = result.rows;
    } else {
      ejercicios = ejerciciosDB;
    }

    if (ejercicios.length === 0) {
      return res.json({
        success: true,
        data: {
          resumen: { total: 0, completados: 0, promedio_general: 0, tiempo_total_segundos: 0 },
          por_ejercicio: []
        }
      });
    }

    const total = ejercicios.length;
    const completados = ejercicios.filter(e => e.completado >= 100).length;
    const promedioGeneral = ejercicios.reduce((sum, e) => sum + e.completado, 0) / total;
    const tiempoTotal = ejercicios.reduce((sum, e) => sum + (e.duracion || 0), 0);

    res.json({
      success: true,
      data: {
        resumen: {
          total: total,
          completados: completados,
          promedio_general: promedioGeneral,
          tiempo_total_segundos: tiempoTotal
        },
        por_ejercicio: []
      }
    });

  } catch (err) {
    console.error('❌ Error obteniendo estadísticas:', err);
    res.status(500).json({ error: 'Error obteniendo estadísticas' });
  }
});

// === SERVIR REACT APP ===
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// === INICIO ===
async function startServer() {
  await initDatabase();
  initWebSocket();
  
  app.listen(HTTP_PORT, '0.0.0.0', () => {
    console.log(`🚀 FullStack Server corriendo en puerto ${HTTP_PORT}`);
    console.log(`📱 Frontend: http://localhost:${HTTP_PORT}`);
    console.log(`🌐 API: http://localhost:${HTTP_PORT}/api`);
    console.log(`📡 WebSocket: puerto ${WS_PORT}`);
    console.log(`💾 Database: ${pool ? 'PostgreSQL' : 'Memoria RAM'}`);
    console.log('✅ ¡Sistema FullStack listo para Railway!');
  });
}

startServer().catch(err => {
  console.error('❌ Error iniciando servidor:', err);
  process.exit(1);
});

process.on('SIGINT', async () => {
  console.log('🔄 Cerrando servidor FullStack...');
  if (pool) await pool.end();
  if (wss) wss.close();
  process.exit(0);
});