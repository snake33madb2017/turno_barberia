const loginContainer = document.getElementById('login-container');
const dashboardContainer = document.getElementById('dashboard-container');
const loginForm = document.getElementById('login-form');
const passInput = document.getElementById('admin-pass');
const errorMsg = document.getElementById('login-error');
const listaTurnos = document.getElementById('lista-turnos');
const soundAdmin = document.getElementById('sound-admin');
const adminFecha = document.getElementById('admin-fecha');

let isAdmin = false;

// Login
loginForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const password = passInput.value;

    fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
    })
        .then(r => r.json())
        .then(data => {
            if (data.success) {
                isAdmin = true;
                loginContainer.classList.add('hidden');
                dashboardContainer.classList.remove('hidden');
                iniciarDashboard();
            } else {
                errorMsg.style.display = 'block';
            }
        });
});

function iniciarDashboard() {
    adminFecha.textContent = new Date().toLocaleDateString();
    cargarTurnos();
    cargarSettings(); // <-- Cargar config
    setInterval(cargarTurnos, 5000); // Refrescar cada 5s
}

function cargarTurnos() {
    if (!isAdmin) return;

    fetch('/api/turnos')
        .then(r => r.json())
        .then(turnos => {
            renderTabla(turnos);
        });
}

function renderTabla(turnos) {
    if (turnos.length === 0) {
        listaTurnos.innerHTML = '<p>No hay turnos registrados.</p>';
        return;
    }

    let html = `
    <div class="table-responsive">
        <table>
            <thead>
                <tr>
                    <th>Turno</th>
                    <th>Cliente</th>
                    <th>Estado</th>
                    <th>Acciones</th>
                </tr>
            </thead>
            <tbody>
    `;

    turnos.forEach(t => {
        let acciones = '';
        if (t.estado === 'pendiente') {
            acciones = `<button onclick="accionTurno('${t.id}', 'iniciar')" class="btn-start">Iniciar</button>`;
        } else if (t.estado === 'activo') {
            acciones = `<button onclick="accionTurno('${t.id}', 'detener')" class="btn-stop">Finalizar</button>`;
        }

        // Notificación WhatsApp
        if ((t.estado === 'pendiente' || t.estado === 'activo') && t.telefono) {
            // Limpiar teléfono de caracteres no numéricos
            const telLimpio = t.telefono.replace(/\D/g, '');
            const mensaje = encodeURIComponent(`Hola ${t.nombre}, tu turno #${t.numero} en la barbería está listo. ¡Te esperamos!`);
            acciones += ` <a href="https://wa.me/${telLimpio}?text=${mensaje}" target="_blank" style="text-decoration:none;">
                            <button style="background:#25D366; color:white; margin-top:5px; border:none; border-radius:4px; padding:8px; cursor:pointer;">📱 Avisar</button>
                          </a>`;
        }

        if (t.estado !== 'cancelado' && t.estado !== 'finalizado') {
            acciones += ` <button onclick="accionTurno('${t.id}', 'cancelar')" class="btn-cancel">Cancelar</button>`;
        }

        html += `
        <tr>
            <td data-label="Turno">#${t.numero}</td>
            <td data-label="Cliente">
                <strong>${t.nombre}</strong> <span style="font-size:0.85em; background:#eee; padding:2px 5px; border-radius:3px; margin-left:5px;">(${t.para_quien || 'Personal'})</span>
                ${t.telefono ? `<br><small style="color:#666;">📞 ${t.telefono}</small>` : ''}
            </td>
            <td data-label="Estado" class="estado-${t.estado}">${t.estado.toUpperCase()}</td>
            <td data-label="Acciones">${acciones}</td>
        </tr>
        `;
    });

    html += '</tbody></table></div>';
    listaTurnos.innerHTML = html;
}

window.accionTurno = function (id, accion) { // Global scope for onclick
    if (!confirm(`¿Confirmar acción: ${accion}?`)) return;

    fetch('/api/admin/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, accion })
    })
        .then(r => r.json())
        .then(data => {
            if (data.success) {
                soundAdmin.play().catch(() => { });
                cargarTurnos();
            } else {
                alert('Error: ' + data.error);
            }
        });
};

// Reset Controls
document.getElementById('btn-reset-dia').addEventListener('click', () => {
    if (confirm('¡CUIDADO! ¿Borrar todos los turnos DE HOY?')) reset('dia');
});

document.getElementById('btn-reset-todo').addEventListener('click', () => {
    if (confirm('¡PELIGRO! ¿Borrar TODO el historial?')) reset('todo');
});

function reset(tipo) {
    fetch('/api/admin/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tipo })
    })
        .then(r => r.json())
        .then(data => {
            alert(data.message);
            cargarTurnos();
        });
}

// Forgot Password
document.getElementById('forgot-password').addEventListener('click', (e) => {
    e.preventDefault();
    if (!confirm('¿Enviar la contraseña actual al correo configurado (snake33madb@gmail.com)?')) return;

    fetch('/api/admin/recover', { method: 'POST' })
        .then(r => r.json())
        .then(data => {
            if (data.success) {
                alert(data.message);
            } else {
                alert('Error: ' + data.error);
            }
        })
        .catch(err => alert('Error de conexión con el servidor.'));
});

// --- CMS Settings Logic ---
const settingsForm = document.getElementById('settings-form');
const inpApertura = document.getElementById('cfg-apertura');
const inpCierre = document.getElementById('cfg-cierre');
const inpPausa = document.getElementById('cfg-pausa');
const inpMsgPausa = document.getElementById('cfg-msg-pausa');
const inpPass = document.getElementById('cfg-password');
const checkboxesDias = document.querySelectorAll('input[name="dias"]');

const inpEmailUser = document.getElementById('cfg-email-user');
const inpEmailPass = document.getElementById('cfg-email-pass');

function cargarSettings() {
    fetch('/api/settings')
        .then(r => r.json())
        .then(data => {
            if (!data) return;

            inpApertura.value = data.horario_apertura || "09:00";
            inpCierre.value = data.horario_cierre || "20:00";
            inpPausa.checked = data.pausa_activa || false;
            inpMsgPausa.value = data.mensaje_pausa || "";
            // Password admin no se muestra

            // Email Settings
            inpEmailUser.value = data.email_user || "";
            inpEmailPass.value = data.email_pass || "";

            // Checkboxes Dias
            const dias = data.dias_laborables || [];
            checkboxesDias.forEach(cb => {
                cb.checked = dias.includes(parseInt(cb.value));
            });
        });
}

settingsForm.addEventListener('submit', (e) => {
    e.preventDefault();

    // Recopilar dias
    const diasSeleccionados = [];
    checkboxesDias.forEach(cb => {
        if (cb.checked) diasSeleccionados.push(parseInt(cb.value));
    });

    const body = {
        horario_apertura: inpApertura.value,
        horario_cierre: inpCierre.value,
        pausa_activa: inpPausa.checked,
        mensaje_pausa: inpMsgPausa.value,
        dias_laborables: diasSeleccionados,
        email_user: inpEmailUser.value.trim(),
        email_pass: inpEmailPass.value.trim()
    };

    if (inpPass.value.trim() !== "") {
        body.password_admin = inpPass.value.trim();
    }

    fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    })
        .then(r => r.json())
        .then(data => {
            if (data.success) {
                alert('Configuración guardada correctamente.');
            } else {
                alert('Error al guardar configuración.');
            }
        });
});

