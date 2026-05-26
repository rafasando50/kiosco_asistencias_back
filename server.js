const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json()); // Para poder recibir datos en formato JSON

// 1. CONEXIÓN A XAMPP (MYSQL)
const db = mysql.createPool({
    host: 'localhost',
    user: 'root',      // Usuario por defecto de XAMPP
    password: '',      // Contraseña por defecto de XAMPP (vacía)
    database: 'kiosko_asistencia', // El nombre que le diste a tu base de datos
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Test de conexión rápida
db.getConnection((err, connection) => {
    if (err) {
        console.error('❌ Error conectando a MySQL en XAMPP:', err.message);
    } else {
        console.log('✅ Conectado con éxito al MySQL de XAMPP');
        connection.release();
    }
});

// 2. ENDPOINTS (RUTAS DE TU API)

// Ruta de prueba para ver si el servidor está vivo
app.get('/', (req, res) => {
    res.send('Servidor del Kiosco corriendo perfectamente 🚀');
});

// Endpoint para obtener las empresas (Lo usará la app para configurar la tableta)
app.get('/api/empresas', (req, res) => {
    db.query('SELECT * FROM empresas', (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

// RUTA DEFINITIVA: Validada con tu estructura real de phpMyAdmin
app.post('/api/asistencia/checar-temporal', (req, res) => {
  const { empleado_id, empresa_id } = req.body;

  if (!empleado_id || !empresa_id) {
    return res.status(400).json({ success: false, error: 'Faltan datos obligatorios (empleado_id o empresa_id)' });
  }

  // 1. Buscamos el último registro usando tu columna exacta 'fecha_hora'
  const sqlBuscarHoy = `
    SELECT tipo 
    FROM asistencias 
    WHERE empleado_id = ? AND DATE(fecha_hora) = CURDATE() 
    ORDER BY fecha_hora DESC 
    LIMIT 1
  `;

  db.query(sqlBuscarHoy, [empleado_id], (err, rows) => {
    if (err) {
      console.error('Error al buscar asistencia de hoy:', err);
      return res.status(500).json({ success: false, error: 'Error en la base de datos al buscar' });
    }

    let nuevoTipo = 'ENTRADA'; // Por defecto si va llegando

    // 2. Si ya hay registros hoy, alternamos el tipo
    if (rows.length > 0) {
      const ultimoRegistro = rows[0].tipo;
      if (ultimoRegistro === 'ENTRADA') {
        nuevoTipo = 'SALIDA';
      } else {
        nuevoTipo = 'ENTRADA';
      }
    }

    // 3. Insertamos usando tu columna 'fecha_hora'. 
    // Usamos NOW() para meter el datetime actual que pide tu campo.
    const sqlInsertar = `
      INSERT INTO asistencias (empleado_id, empresa_id, tipo, fecha_hora) 
      VALUES (?, ?, ?, NOW())
    `;

    db.query(sqlInsertar, [empleado_id, empresa_id, nuevoTipo], (insertErr, result) => {
      if (insertErr) {
        console.error('Error al insertar asistencia:', insertErr);
        return res.status(500).json({ success: false, error: 'No se pudo guardar el registro' });
      }

      const mensajeExito = nuevoTipo === 'ENTRADA' 
        ? 'Registro de ENTRADA guardado con éxito' 
        : 'Registro de SALIDA guardado con éxito';

      console.log(`[Asistencia] Empleado ${empleado_id} registró ${nuevoTipo} correctamente.`);
      
      res.json({
        success: true,
        message: mensajeExito,
        tipo: nuevoTipo
      });
    });
  });
});



// 3. ARRANCAR EL SERVIDOR
const PORT = 3000;
app.listen(PORT, () => {
    console.log(`🚀 Servidor escuchando en http://localhost:${PORT}`);
});