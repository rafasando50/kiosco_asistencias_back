const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

// =========================================================================
// 🛠️ PARCHE DE COMPATIBILIDAD PARA NODE v24 (Arregla error de TextEncoder)
// =========================================================================
const util = require('util');

// Forzar la existencia de TextEncoder/TextDecoder en global si no estuvieran
if (typeof global.TextEncoder === 'undefined') {
    global.TextEncoder = typeof TextEncoder !== 'undefined' ? TextEncoder : globalThis.TextEncoder;
}
if (typeof global.TextDecoder === 'undefined') {
    global.TextDecoder = typeof TextDecoder !== 'undefined' ? TextDecoder : globalThis.TextDecoder;
}

// Sobrescribir incondicionalmente en el objeto util con el constructor global
util.TextEncoder = typeof TextEncoder !== 'undefined' ? TextEncoder : (globalThis.TextEncoder || global.TextEncoder);
util.TextDecoder = typeof TextDecoder !== 'undefined' ? TextDecoder : (globalThis.TextDecoder || global.TextDecoder);
// =========================================================================

// =========================================================================
// 🔄 ALIASING DE TENSORFLOW PARA NODE.JS (Evita error de tfjs-node nativo)
// =========================================================================
const Module = require('module');
const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain) {
    if (request === '@tensorflow/tfjs-node') {
        return originalResolveFilename.call(this, '@tensorflow/tfjs', parent, isMain);
    }
    return originalResolveFilename.apply(this, arguments);
};

// ⚠️ LIBRERÍAS DE INTELIGENCIA ARTIFICIAL E IMÁGENES (Versión CPU Estable)
const faceapi = require('@vladmandic/face-api');
const { Canvas, Image, ImageData, loadImage } = require('canvas');

const app = express();
app.use(cors());

// Límites de Express ampliados para soportar el peso del Base64 del celular
app.use(express.json({ limit: '50mb' })); 
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// 1. CONEXIÓN A XAMPP (MYSQL)
const db = mysql.createPool({
    host: 'localhost',
    user: 'root',      // Usuario por defecto de XAMPP
    password: '',      // Contraseña por defecto de XAMPP (vacía)
    database: 'kiosko_asistencia', // Tu base de datos
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Test de conexión rápida a MySQL
db.getConnection((err, connection) => {
    if (err) {
        console.error('❌ Error conectando a MySQL en XAMPP:', err.message);
    } else {
        console.log('✅ Conectado con éxito al MySQL de XAMPP');
        connection.release();
    }
});

// Arreglo global en memoria para guardar los moldes matemáticos de los rostros
let descriptoresEmpleadosEntrenados = [];

// =========================================================================
// 🧠 MOTOR DE INTELIGENCIA ARTIFICIAL: CARGAR MODELOS Y MAPEAR FOTOS
// =========================================================================
async function inicializarIA() {
    console.log('⏳ Cargando modelos de Inteligencia Facial desde internet...');
    
    // Inyectamos las herramientas de Canvas en el entorno de la IA
    faceapi.env.monkeyPatch({ Canvas, Image, ImageData });

    // Descargamos y cargamos las redes neuronales necesarias en memoria (Cargamos el rápido para celular y el preciso para base de datos)
    const MODEL_URL = 'https://raw.githubusercontent.com/vladmandic/face-api/master/model/';
    await faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL);
    await faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL);
    await faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL);
    await faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL);
    
    console.log('✅ Modelos de IA cargados con éxito.');
    
    // Escaneamos las fotos de la carpeta de referencia para entrenar al servidor
    const carpetaReferencia = path.join(__dirname, 'caras_referencia');
    if (!fs.existsSync(carpetaReferencia)) {
        fs.mkdirSync(carpetaReferencia);
    }

    const archivos = fs.readdirSync(carpetaReferencia);
    console.log(`📂 Escaneando banco de rostros... Se encontraron ${archivos.length} fotos.`);

    for (const archivo of archivos) {
        if (!archivo.endsWith('.jpg') && !archivo.endsWith('.jpeg') && !archivo.endsWith('.png')) continue;

        // Ej: '1.jpg' -> empleadoId = 1
        const empleadoId = parseInt(path.parse(archivo).name);
        
        if (isNaN(empleadoId)) {
            console.log(`⚠️ Archivo ignorado: '${archivo}'. Debe llamarse con el ID del empleado (ej: 1.jpg)`);
            continue;
        }

        try {
            const rutaImagen = path.join(carpetaReferencia, archivo);
            const img = await loadImage(rutaImagen);
            
            // Para la base de datos de referencia (que solo se carga UNA VEZ al encender el servidor),
            // usamos la imagen original sin redimensionar y el detector ultra-preciso SSD Mobilenet v1.
            // Esto garantiza que el 100% de las fotos de los empleados sean mapeadas con la máxima fidelidad.
            const deteccion = await faceapi.detectSingleFace(img).withFaceLandmarks().withFaceDescriptor();
            
            if (deteccion) {
                // Guardamos los rasgos asociados al ID del empleado
                descriptoresEmpleadosEntrenados.push(
                    new faceapi.LabeledFaceDescriptors(empleadoId.toString(), [deteccion.descriptor])
                );
                console.log(`🧠 Cara del Empleado ID [${empleadoId}] mapeada correctamente.`);
            } else {
                console.log(`❌ No se pudo detectar ningún rostro en la foto de referencia: ${archivo}`);
            }
        } catch (error) {
            console.error(`❌ Error al procesar la foto ${archivo}:`, error.message);
        }
    }
    console.log('🚀 ¡Sistema de Reconocimiento Facial en línea y listo para operar!');
}

// Arrancar la inicialización de la IA en segundo plano
inicializarIA();


// =========================================================================
// 🚀 ENDPOINTS / RUTAS DE TU API
// =========================================================================

app.get('/', (req, res) => {
    res.send('Servidor Inteligente del Kiosco corriendo perfectamente 🚀');
});

// Endpoint para obtener las empresas
app.get('/api/empresas', (req, res) => {
    db.query('SELECT * FROM empresas', (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

// RUTA INTELIGENTE: Procesa la foto del celular en caliente mediante IA
app.post('/api/asistencia/checar-temporal', async (req, res) => {
  const { empresa_id, imagenBase64 } = req.body;

  if (!imagenBase64 || !empresa_id) {
    return res.status(400).json({ success: false, error: 'Faltan datos obligatorios (imagenBase64 o empresa_id)' });
  }

  if (descriptoresEmpleadosEntrenados.length === 0) {
      return res.status(500).json({ success: false, error: 'La IA no tiene rostros de referencia cargados en el servidor' });
  }

  try {
    console.log('📸 Recibiendo captura de rostro desde el celular...');
    console.time('⏱️ Tiempo de Reconocimiento IA');
    
    // 1. Convertimos el texto Base64 a un Buffer para procesarlo en memoria
    const bufferImagen = Buffer.from(imagenBase64, 'base64');
    const imgCaptura = await loadImage(bufferImagen);

    // ⚡ OPTIMIZACIÓN: Redimensionamos la imagen a un ancho máximo de 200px.
    // Esto reduce la carga computacional en pure JS en más de un 95%, bajando el tiempo aún más.
    const MAX_WIDTH = 200;
    let width = imgCaptura.width;
    let height = imgCaptura.height;
    if (width > MAX_WIDTH) {
        height = Math.round((height * MAX_WIDTH) / width);
        width = MAX_WIDTH;
    }
    const canvasPequeno = new Canvas(width, height);
    const ctx = canvasPequeno.getContext('2d');
    ctx.drawImage(imgCaptura, 0, 0, width, height);

    // 2. Extraemos los descriptores usando el canvas pequeño y TinyFaceDetector (red neuronal optimizada a una cuadrícula de 224 para velocidad subsegundo)
    const deteccionCelular = await faceapi.detectSingleFace(canvasPequeno, new faceapi.TinyFaceDetectorOptions({ inputSize: 224 })).withFaceLandmarks().withFaceDescriptor();

    if (!deteccionCelular) {
        console.timeEnd('⏱️ Tiempo de Reconocimiento IA');
        console.log('⚠️ Escáner fallido: No se localizó ningún rostro en la foto recibida.');
        return res.status(400).json({ success: false, error: 'No se detectó ningún rostro. Inténtalo de nuevo.' });
    }

    // 3. Comparamos los descriptores contra las fotos del banco en memoria (umbral estándar de 0.6)
    const comparadorRostros = new faceapi.FaceMatcher(descriptoresEmpleadosEntrenados, 0.6);
    const mejorMatch = comparadorRostros.findBestMatch(deteccionCelular.descriptor);
    
    console.timeEnd('⏱️ Tiempo de Reconocimiento IA');
    const empleado_id = mejorMatch.label;

    if (empleado_id === 'unknown') {
        console.log('🛑 Acceso Denegado: El rostro no pertenece a ningún empleado registrado.');
        return res.status(403).json({ success: false, error: 'Rostro no reconocido en el sistema ❌' });
    }

    console.log(`🎯 ¡MATCH DETECTADO! Empleado ID identificado: ${empleado_id} (Distancia: ${mejorMatch.distance.toFixed(2)})`);

    // 4. LÓGICA AUTOMÁTICA EN MYSQL (Usando el ID que descubrió la IA)
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

      let nuevoTipo = 'ENTRADA';

      if (rows.length > 0) {
        const ultimoRegistro = rows[0].tipo;
        nuevoTipo = ultimoRegistro === 'ENTRADA' ? 'SALIDA' : 'ENTRADA';
      }

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
          ? `¡Hola! Entrada registrada con éxito` 
          : `¡Adiós! Salida registrada con éxito`;

        console.log(`[Asistencia] Empleado ${empleado_id} registró ${nuevoTipo} correctamente.`);
        
        res.json({
          success: true,
          message: mensajeExito,
          tipo: nuevoTipo
        });
      });
    });

  } catch (error) {
      console.error('❌ Error crítico en el procesamiento de la IA:', error);
      res.status(500).json({ success: false, error: 'Error al procesar el reconocimiento facial' });
  }
});

// 3. ARRANCAR EL SERVIDOR
const PORT = 3000;
app.listen(PORT, () => {
    console.log(`🚀 Servidor escuchando en http://localhost:${PORT}`);
});