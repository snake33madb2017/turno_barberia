const formContainer = document.getElementById('form-container');
const turnoDisplay = document.getElementById('turno-display');
const nombreInput = document.getElementById('nombre-input');
const btnPedir = document.getElementById('btn-pedir');
const btnCancelar = document.getElementById('btn-cancelar');
const fechaHoyEl = document.getElementById('fecha-hoy');
const closedMessageEl = document.getElementById('closed-message');

const clienteNombreEl = document.getElementById('cliente-nombre');
const turnoNumeroEl = document.getElementById('turno-numero');
const turnoMensajeEl = document.getElementById('turno-mensaje');
const cronoEl = document.getElementById('crono');
const relojActualEl = document.getElementById('reloj-actual');

const soundStart = document.getElementById('sound-start');
const soundEnd = document.getElementById('sound-end');

// Unlock Audio Context on first interaction
function unlockAudio() {
    soundStart.play().then(() => { soundStart.pause(); soundStart.currentTime = 0; }).catch(e => { });
    soundEnd.play().then(() => { soundEnd.pause(); soundEnd.currentTime = 0; }).catch(e => { });
    document.removeEventListener('click', unlockAudio);
    document.removeEventListener('touchstart', unlockAudio);
}
document.addEventListener('click', unlockAudio);
document.addEventListener('touchstart', unlockAudio);

let currentTurnId = localStorage.getItem('barberia_turno_id');
let estadoPrevio = '';
let acumuladoCrono = 0;
let inicioCrono = 0;

// Inicialización
function init() {
    // Reloj
    setInterval(() => {
        relojActualEl.textContent = new Date().toLocaleTimeString();
    }, 1000);

    // Cronometro
    setInterval(actualizarCrono, 1000);

    // Verificar Estado General
    fetch('/api/status')
        .then(r => r.json())
        .then(data => {
            fechaHoyEl.textContent = data.fecha;
            if (!data.abierto) {
                closedMessageEl.textContent = data.mensaje;
                closedMessageEl.classList.remove('hidden');
                // Si está cerrado, ocultamos formulario si no tiene turno
                if (!currentTurnId) formContainer.style.display = 'none';
            }
        });

    if (currentTurnId) {
        mostrarVistaTurno();
        pollTurno(); // Iniciar polling
        setInterval(pollTurno, 3000); // Polling cada 3s
    }
}

// Event Listeners
btnPedir.addEventListener('click', pedirTurno);
btnCancelar.addEventListener('click', cancelarTurno);

const telefonoInput = document.getElementById('telefono-input');

function pedirTurno() {
    const nombre = nombreInput.value.trim();
    const telefono = telefonoInput.value.trim();
    if (!nombre) return alert('Por favor ingresa tu nombre');

    fetch('/api/turnos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nombre, telefono })
    })
        .then(r => r.json())
        .then(data => {
            if (data.error) return alert(data.error);

            currentTurnId = data.id;
            localStorage.setItem('barberia_turno_id', currentTurnId);
            location.reload(); // Recargar para mostrar vista de turno
        })
        .catch(err => alert('Error al pedir turno'));
}

function cancelarTurno() {
    if (!confirm('¿Seguro que quieres cancelar tu turno?')) return;

    fetch('/api/turnos/cancelar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: currentTurnId })
    })
        .then(r => r.json())
        .then(data => {
            if (data.success) {
                limpiarSesion();
            } else {
                alert('Error al cancelar');
            }
        });
}

function limpiarSesion() {
    localStorage.removeItem('barberia_turno_id');
    location.reload();
}

function mostrarVistaTurno() {
    formContainer.classList.add('hidden');
    turnoDisplay.classList.remove('hidden');
}

function actualizarCrono() {
    // Si hay un tiempo de inicio activo, calculamos
    let total = acumuladoCrono;
    if (inicioCrono > 0) {
        const ahora = Math.floor(Date.now() / 1000);
        total += (ahora - inicioCrono);
    }

    if (total < 0) total = 0;

    const m = Math.floor(total / 60).toString().padStart(2, '0');
    const s = (total % 60).toString().padStart(2, '0');
    cronoEl.textContent = `${m}:${s}`;
}

function pollTurno() {
    if (!currentTurnId) return;

    fetch(`/api/turnos/${currentTurnId}`)
        .then(r => {
            if (r.status === 404) {
                // Turno ya no existe (probablemente reset diario)
                alert('Tu turno ha expirado o ha sido eliminado.');
                limpiarSesion();
                return null;
            }
            return r.json();
        })
        .then(data => {
            if (!data) return;

            // Actualizar UI
            turnoNumeroEl.textContent = '#' + (data.numero || '?'); // Necesitamos el número, pero el endpoint /turns/:id no lo devolvía en el server.js... VOY A REVISAR server.js
            // ERROR: En server.js `api/turnos/:id` devuelve { id, estado, inicio, acumulado, mensaje }. NO devuelve 'nombre' ni 'numero'. 
            // Voy a asumir que debo corregir server.js o lidiar con ello. 
            // Para arreglarlo rápido, puedo arreglar server.js después o ahora. 
            // MEJOR: Arreglaré server.js en un paso posterior si falla, pero es un bug obvio. 
            // Sin embargo, si el endpoint devuelve el objeto turno entero sería mejor.
            // En mi codigo server.js:
            /*
            app.get('/api/turnos/:id', (req, res) => {
                const data = leerDatos();
                const turno = data.turnos.find(t => t.id === req.params.id);
                // ...
                res.json({
                    id: turno.id,
                    estado: turno.estado,
                    inicio: turno.inicio,
                    acumulado: turno.tiempo_acumulado,
                    mensaje: turno.mensaje
                });
            });
            */
            // FALTA nombre y numero. 
            // Seguiré asumiendo que el usuario no ve el número si falla, pero voy a hacer una tool call para arreglar server.js porque es crítico.

            // Wait, I cannot edit server.js right now effectively while writing this file. I will finish this file assuming the server returns `numero` and `nombre` (I will fix server.js next).

            clienteNombreEl.textContent = data.nombre || localStorage.getItem('barberia_nombre_temp') || 'Cliente';
            // Guardaré el nombre en localstorage al pedirlo por si acaso, pero lo correcto es que venga del server.

            turnoMensajeEl.textContent = data.mensaje;

            inicioCrono = data.inicio;
            acumuladoCrono = data.acumulado;

            // Cambios de estado y sonidos
            if (estadoPrevio !== data.estado) {
                if (data.estado === 'activo') {
                    soundStart.play().catch(e => console.log(e));
                    turnoMensajeEl.style.color = 'green';
                    turnoMensajeEl.textContent = '¡ES TU TURNO!';
                } else if (data.estado === 'finalizado') {
                    soundEnd.play().catch(e => console.log(e));
                    turnoMensajeEl.style.color = 'gray';
                    setTimeout(limpiarSesion, 4000); // Auto salir
                } else if (data.estado === 'cancelado') {
                    // Ahora también reproduce sonido al cancelar
                    soundEnd.play().catch(e => console.log(e));
                    turnoMensajeEl.style.color = 'red';
                    setTimeout(limpiarSesion, 3000);
                }
                estadoPrevio = data.estado;
            }

            // Fix temporal para numero si el server no lo manda
            // Buscaré en la lista pública si es necesario, pero mejor arreglo el server.
        });
}

// Al pedir turno, guardamos nombre temporalmente para UI inmediata si el server falla
const btnPedirOriginal = btnPedir.onclick; // no, usamos addEventListener
btnPedir.addEventListener('click', () => {
    localStorage.setItem('barberia_nombre_temp', nombreInput.value);
});

init();
