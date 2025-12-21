const formContainer = document.getElementById('form-container');
const activeTurnsContainer = document.getElementById('active-turns-container');
const turnosList = document.getElementById('turnos-list');

const nombreInput = document.getElementById('nombre-input');
const telefonoInput = document.getElementById('telefono-input');
const paraQuienSelect = document.getElementById('para-quien-select');
const btnPedir = document.getElementById('btn-pedir');

const fechaHoyEl = document.getElementById('fecha-hoy');
const closedMessageEl = document.getElementById('closed-message');

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

// State Management
let myTurnIds = JSON.parse(localStorage.getItem('barberia_turnos_ids') || '[]');
let turnStates = {}; // Map to track previous state of each turn for sound alerts

// Inicialización
function init() {
    // Reloj
    /* setInterval(() => {
        // Clock removed from global view, maybe add per card or header? 
        // Keeping it simple for now as requested.
    }, 1000); */

    // Verificar Estado General
    fetch('/api/status')
        .then(r => r.json())
        .then(data => {
            fechaHoyEl.textContent = data.fecha;
            if (!data.abierto) {
                closedMessageEl.textContent = data.mensaje;
                closedMessageEl.classList.remove('hidden');
                // Si cerrado, ocultamos formulario
                formContainer.style.display = 'none';
            }
        });

    if (myTurnIds.length > 0) {
        activeTurnsContainer.classList.remove('hidden');
        pollTurnos();
        setInterval(pollTurnos, 3000);
        setInterval(updateCronos, 1000);
    }
}

btnPedir.addEventListener('click', pedirTurno);

function pedirTurno() {
    const nombre = nombreInput.value.trim();
    const telefono = telefonoInput.value.trim();
    const paraQuien = paraQuienSelect.value;

    if (!nombre) return alert('Por favor ingresa tu nombre');

    fetch('/api/turnos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nombre, telefono, para_quien: paraQuien })
    })
        .then(r => r.json())
        .then(data => {
            if (data.error) return alert(data.error);

            // Add new ID to list
            myTurnIds.push(data.id);
            saveTurnIds();

            // Show list and refresh immediately
            activeTurnsContainer.classList.remove('hidden');
            pollTurnos();

            // Optional: Clear form or keep name/phone for convenience? 
            // Better to keep name for convenience if they add for family
            // alert('Turno solicitado con éxito'); 
        })
        .catch(err => alert('Error al pedir turno'));
}

function cancelarTurno(id) {
    if (!confirm('¿Seguro que quieres cancelar este turno?')) return;

    fetch('/api/turnos/cancelar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id })
    })
        .then(r => r.json())
        .then(data => {
            if (data.success) {
                // We keep it in list until next poll shows it as canceled/removed or handle removal?
                // Actually server sets it to canceled. We should let poll handle the UI update.
                pollTurnos();
            } else {
                alert('Error al cancelar');
            }
        });
}

function saveTurnIds() {
    localStorage.setItem('barberia_turnos_ids', JSON.stringify(myTurnIds));
}

function removeTurnId(id) {
    myTurnIds = myTurnIds.filter(tid => tid !== id);
    saveTurnIds();
    if (myTurnIds.length === 0) {
        activeTurnsContainer.classList.add('hidden');
    }
}

function pollTurnos() {
    if (myTurnIds.length === 0) return;

    // We fetch each turn. In a larger app we'd have a bulk endpoint, but this is fine.
    myTurnIds.forEach(id => {
        fetch(`/api/turnos/${id}`)
            .then(r => {
                if (r.status === 404) return null;
                return r.json();
            })
            .then(data => {
                updateTurnCard(id, data);
            });
    });
}

function updateTurnCard(id, data) {
    // If turn not found (404), maybe remove it?
    if (!data) {
        removeTurnId(id);
        const el = document.getElementById(`turn-card-${id}`);
        if (el) el.remove();
        return;
    }

    // Check state change for sound
    const prevState = turnStates[id];
    if (prevState !== data.estado) {
        if (data.estado === 'activo') {
            soundStart.play().catch(() => { });
        } else if (data.estado === 'finalizado' || data.estado === 'cancelado') {
            soundEnd.play().catch(() => { });
            // If finished/canceled, maybe remove after delay?
            if (data.estado === 'finalizado' || data.estado === 'cancelado') {
                setTimeout(() => removeTurnId(id), 10000); // Remove from local list after 10s
            }
        }
        turnStates[id] = data.estado;
    }

    // Render/Update Card
    let card = document.getElementById(`turn-card-${id}`);
    if (!card) {
        card = document.createElement('div');
        card.id = `turn-card-${id}`;
        card.className = 'turn-card-item';
        // Add basic styles directly or class
        card.style.cssText = "border:1px solid #ddd; background:rgba(255,255,255,0.8); padding:15px; margin-bottom:10px; border-radius:8px;";
        turnosList.appendChild(card);
    }

    // Colors/Text based on state
    let stateColor = '#333';
    if (data.estado === 'pendiente') stateColor = '#0073aa';
    if (data.estado === 'activo') stateColor = '#28a745';
    if (data.estado === 'finalizado') stateColor = '#6c757d';
    if (data.estado === 'cancelado') stateColor = '#d9534f';

    const cleanParaQuien = data.para_quien || 'Personal';

    card.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #eee; padding-bottom:5px; margin-bottom:10px;">
            <span style="font-weight:bold; font-size:1.2em;">#${data.numero || '?'}</span>
            <span style="font-size:0.9em; background:#eee; padding:2px 6px; border-radius:4px;">${cleanParaQuien}</span>
        </div>
        <div style="margin-bottom:10px;">
            <strong style="color:${stateColor}; font-size:1.1em; text-transform:uppercase;">${data.estado}</strong>
            <p style="margin:5px 0;">${data.mensaje}</p>
            ${data.inicio > 0 ? `<p>Tiempo: <span class="crono-turn" data-start="${data.inicio}" data-accum="${data.acumulado || 0}">00:00</span></p>` : ''}
        </div>
        <div style="text-align:right;">
             ${(data.estado !== 'finalizado' && data.estado !== 'cancelado') ?
            `<button onclick="cancelarTurno('${id}')" class="btn-cancel" style="padding:8px 12px; font-size:0.9em;">Cancelar</button>` :
            `<small>Turno cerrado</small>`}
        </div>
    `;
}

function updateCronos() {
    const cronos = document.querySelectorAll('.crono-turn');
    const now = Math.floor(Date.now() / 1000);

    cronos.forEach(el => {
        const start = parseInt(el.dataset.start);
        const accum = parseInt(el.dataset.accum);
        if (start > 0) {
            let total = accum + (now - start);
            if (total < 0) total = 0;
            const m = Math.floor(total / 60).toString().padStart(2, '0');
            const s = (total % 60).toString().padStart(2, '0');
            el.textContent = `${m}:${s}`;
        }
    });
}

init();
