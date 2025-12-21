const express = require('express');
const nodemailer = require('nodemailer');
const bodyParser = require('body-parser');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data', 'data.json');

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Inicializar archivo de datos si no existe
function inicializarDatos() {
    if (!fs.existsSync(DATA_FILE)) {
        const initialState = {
            config: {
                ultimo_turno: 0,
                fecha_historial: new Date().toISOString().split('T')[0],
                turno_actual: 0
            },
            turnos: [],
            reset_log: [],
            settings: { // Configuración por defecto
                horario_apertura: "09:00",
                horario_cierre: "20:15",
                dias_laborables: [1, 2, 3, 4, 5, 6], // Lunes a Sabado
                password_admin: "admin",
                pausa_activa: false,
                mensaje_pausa: "Estamos en un breve descanso. Volvemos pronto.",
                email_user: "",
                email_pass: ""
            }
        };
        fs.writeFileSync(DATA_FILE, JSON.stringify(initialState, null, 2));
    } else {
        // Migración simple: asegurar que settings existe si el archivo ya existía sin settings
        const data = leerDatos();
        if (!data.settings) {
            data.settings = {
                horario_apertura: "09:00",
                horario_cierre: "20:15",
                dias_laborables: [1, 2, 3, 4, 5, 6],
                password_admin: "admin",
                pausa_activa: false,
                mensaje_pausa: "Estamos en un breve descanso. Volvemos pronto."
            };
            guardarDatos(data);
        }
    }
}

// Funciones Auxiliares
function leerDatos() {
    try {
        const data = fs.readFileSync(DATA_FILE, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        return { config: {}, turnos: [], reset_log: [], settings: {} };
    }
}

function guardarDatos(data) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function obtenerFechaHoy() {
    const now = new Date();
    // Formato simple YYYY-MM-DD
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

// Inicializar al arranque
inicializarDatos();

// Lógica de Reinicio Diario
function verificarReinicioDiario() {
    const data = leerDatos();
    const hoy = obtenerFechaHoy();

    // Si la fecha guardada es distinta a hoy, reseteamos turnos
    if (data.config.fecha_historial !== hoy) {
        data.turnos = [];
        data.config.ultimo_turno = 0;
        data.config.fecha_historial = hoy;
        guardarDatos(data);
        console.log(`[Sistema] Reinicio diario ejecutado para fecha: ${hoy}`);
    }
}

// --- API ROUTES ---

// 1. Estado General / Cliente
app.get('/api/status', (req, res) => {
    verificarReinicioDiario();
    const data = leerDatos();
    const settings = data.settings; // Still use settings for manual pause

    const now = new Date();
    const diaSemana = now.getDay(); // 0 = Domingo, 1 = Lunes...
    const horaActual = now.getHours();
    const minutoActual = now.getMinutes();
    const tiempoActual = horaActual * 60 + minutoActual; // Minutos desde 00:00

    let abierto = false;
    let mensaje = '';
    let horarioHoy = '';

    // Lógica de Horarios "Barbería Snake"
    // Helper: Convertir HH:MM a minutos
    const toMin = (str) => {
        const [h, m] = str.split(':').map(Number);
        return h * 60 + m;
    };

    // 1. Verificación Inicial: ¿Abre hoy según Admin?
    if (!settings.dias_laborables.includes(diaSemana)) {
        abierto = false;
        mensaje = "Hoy estamos cerrados por descanso semanal.";
    } else {
        // 2. Lógica de Horarios Automáticos
        if (diaSemana >= 1 && diaSemana <= 5) {
            // Lunes a Viernes
            horarioHoy = "09:00 - 13:30 y 16:00 - 20:00";
            if (
                (tiempoActual >= toMin("09:00") && tiempoActual < toMin("13:30")) ||
                (tiempoActual >= toMin("16:00") && tiempoActual < toMin("20:00"))
            ) {
                abierto = true;
            } else {
                if (tiempoActual >= toMin("13:30") && tiempoActual < toMin("16:00")) {
                    mensaje = "Estamos en el descanso de mediodía (13:30 - 16:00).";
                } else {
                    mensaje = `Cerrado. Horario hoy: ${horarioHoy}`;
                }
            }
        } else if (diaSemana === 6 || diaSemana === 0) {
            // Sábado y Domingo -> 09:00 - 14:00 Y 16:00 - 20:00
            horarioHoy = "09:00 - 14:00 y 16:00 - 20:00";
            if (
                (tiempoActual >= toMin("09:00") && tiempoActual < toMin("14:00")) ||
                (tiempoActual >= toMin("16:00") && tiempoActual < toMin("20:00"))
            ) {
                abierto = true;
            } else {
                if (tiempoActual >= toMin("14:00") && tiempoActual < toMin("16:00")) {
                    mensaje = "Estamos en el descanso de fin de semana (14:00 - 16:00).";
                } else {
                    mensaje = `Cerrado. Horario fin de semana: ${horarioHoy}`;
                }
            }
        }
    }

    // Override Manual desde Panel Admin (Pausa activa)
    if (settings.pausa_activa) {
        abierto = false;
        mensaje = settings.mensaje_pausa || "Pausa momentánea del barbero.";
    }

    // Formatear hora para devolver
    const horaString = `${String(horaActual).padStart(2, '0')}:${String(minutoActual).padStart(2, '0')}`;

    res.json({
        abierto,
        mensaje,
        fecha: obtenerFechaHoy(),
        hora: horaString,
        horario: horarioHoy
    });
});

// 2. Obtener Turnos
app.get('/api/turnos', (req, res) => {
    verificarReinicioDiario();
    const data = leerDatos();
    const turnosPublicos = data.turnos.map(t => ({
        id: t.id,
        numero: t.numero,
        nombre: t.nombre,
        telefono: t.telefono, // Incluir teléfono para admin
        para_quien: t.para_quien, // Nuevo campo
        estado: t.estado,
        mensaje: t.mensaje,
        inicio: t.inicio,
        tiempo_acumulado: t.tiempo_acumulado
    }));
    res.json(turnosPublicos);
});

// 3. Crear Turno
app.post('/api/turnos', (req, res) => {
    verificarReinicioDiario();
    const { nombre, telefono, para_quien } = req.body;
    if (!nombre) return res.status(400).json({ error: 'El nombre es obligatorio' });

    const data = leerDatos();
    const nuevoNumero = (parseInt(data.config.ultimo_turno) || 0) + 1;

    const nuevoTurno = {
        id: Date.now().toString(),
        numero: nuevoNumero,
        nombre: nombre,
        telefono: telefono || '',
        para_quien: para_quien || 'Personal', // Default to Personal
        estado: 'pendiente',
        mensaje: 'Esperando turno',
        inicio: 0,
        tiempo_acumulado: 0,
        fecha: obtenerFechaHoy(),
        creado: Date.now()
    };

    data.turnos.push(nuevoTurno);
    data.config.ultimo_turno = nuevoNumero;
    guardarDatos(data);

    res.json(nuevoTurno);
});

// 4. Polling Estado Turno Individual
app.get('/api/turnos/:id', (req, res) => {
    const data = leerDatos();
    const turno = data.turnos.find(t => t.id === req.params.id);
    if (!turno) return res.status(404).json({ error: 'Turno no encontrado' });

    res.json({
        id: turno.id,
        numero: turno.numero,
        nombre: turno.nombre,
        para_quien: turno.para_quien,
        estado: turno.estado,
        inicio: turno.inicio,
        acumulado: turno.tiempo_acumulado,
        mensaje: turno.mensaje
    });
});

// 5. Cancelar Turno (Cliente)
app.post('/api/turnos/cancelar', (req, res) => {
    const { id } = req.body;
    const data = leerDatos();
    const index = data.turnos.findIndex(t => t.id === id);

    if (index !== -1) {
        data.turnos[index].estado = 'cancelado';
        data.turnos[index].mensaje = 'Turno cancelado por el cliente.';
        data.turnos[index].inicio = 0;
        data.turnos[index].tiempo_acumulado = 0;
        guardarDatos(data);
        res.json({ success: true, message: 'Turno cancelado' });
    } else {
        res.status(404).json({ error: 'Turno no encontrado' });
    }
});

// --- ADMIN ROUTES ---

// 6. Login Admin
app.post('/api/admin/login', (req, res) => {
    const { password } = req.body;
    const data = leerDatos();
    const currentPass = data.settings ? data.settings.password_admin : 'admin';

    if (password === currentPass) {
        res.json({ success: true });
    } else {
        res.status(401).json({ success: false, message: 'Contraseña incorrecta' });
    }
});

// 7. Acciones Admin Turnos (Iniciar, Detener, Cancelar)
app.post('/api/admin/action', (req, res) => {
    const { id, accion } = req.body;
    const data = leerDatos();
    const index = data.turnos.findIndex(t => t.id === id);
    if (index === -1) return res.status(404).json({ error: 'Turno no encontrado' });

    const turno = data.turnos[index];
    const ahora = Math.floor(Date.now() / 1000);

    switch (accion) {
        case 'iniciar':
            turno.estado = 'activo';
            turno.inicio = ahora;
            turno.mensaje = 'Tu turno ha iniciado. ¡Prepárate!';
            break;
        case 'detener':
            if (turno.inicio > 0) turno.tiempo_acumulado += (ahora - turno.inicio);
            turno.estado = 'finalizado';
            turno.inicio = 0;
            turno.mensaje = 'Tu turno ha finalizado.';
            break;
        case 'cancelar':
            turno.estado = 'cancelado';
            turno.inicio = 0;
            turno.tiempo_acumulado = 0;
            turno.mensaje = 'Tu turno ha sido cancelado por el administrador.';
            break;
        default:
            return res.status(400).json({ error: 'Acción desconocida' });
    }

    guardarDatos(data);
    res.json({ success: true, turno });
});

// 8. Reset Manual
app.post('/api/admin/reset', (req, res) => {
    const { tipo } = req.body;
    const data = leerDatos();
    const hoy = obtenerFechaHoy();
    let count = 0;

    if (tipo === 'dia') {
        const nuevosTurnos = data.turnos.filter(t => t.fecha !== hoy);
        count = data.turnos.length - nuevosTurnos.length;
        data.turnos = nuevosTurnos;
        if (data.turnos.length === 0) data.config.ultimo_turno = 0;
    } else {
        count = data.turnos.length;
        data.turnos = [];
        data.config.ultimo_turno = 0;
    }

    data.reset_log.push({ fecha: new Date().toISOString(), tipo, eliminados: count });
    guardarDatos(data);
    res.json({ success: true, message: `Se eliminaron ${count} turnos.` });
});

// 9. --- NEW CMS CONFIG ROUTES ---

// GET Settings
app.get('/api/settings', (req, res) => {
    // Idealmente verificar auth aquí
    const data = leerDatos();
    res.json(data.settings || {});
});

// UPDATE Settings
app.post('/api/settings', (req, res) => {
    const newSettings = req.body;
    const data = leerDatos();

    // Validación básica y fusión
    data.settings = { ...data.settings, ...newSettings };

    // Convertir días a enteros si vienen como strings (checkboxes value)
    if (data.settings.dias_laborables) {
        data.settings.dias_laborables = data.settings.dias_laborables.map(Number);
    }

    guardarDatos(data);
    res.json({ success: true, settings: data.settings });
});


// ... (existing code for initialState settings) ...
// The user's instruction to update `inicializarDatos` is not applicable to the provided snippet as the function is not present.
// The stray settings block has been removed as requested.

// 9. --- NEW CMS CONFIG ROUTES ---
// ... (existing routes) ...

// 10. Recuperar Contraseña
app.post('/api/admin/recover', async (req, res) => {
    const data = leerDatos();
    const settings = data.settings;

    if (!settings.email_user || !settings.email_pass) {
        return res.status(400).json({ error: 'Falta configurar el correo de envío en el panel.' });
    }

    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: settings.email_user,
            pass: settings.email_pass
        }
    });

    const mailOptions = {
        from: settings.email_user,
        to: 'snake33madb@gmail.com', // Destinatario fijo solicitado
        subject: 'Recuperación de Contraseña - Peluquería Xoaquín',
        text: `Hola,
        
La contraseña actual de tu panel de administración es: ${settings.password_admin}

Saludos,
Peluquería Xoaquín.`
    };

    try {
        await transporter.sendMail(mailOptions);
        res.json({ success: true, message: 'Contraseña enviada a snake33madb@gmail.com' });
    } catch (error) {
        console.error('Error enviando email:', error);
        res.status(500).json({ error: 'Error al enviar el correo. Verifica las credenciales en el servidor.' });
    }
});

app.listen(PORT, () => {
    console.log(`Servidor de Peluquería Xoaquín corriendo en http://localhost:${PORT}`);
});
