<?php
/**
 * Plugin Name: Turnos Barbería - Unificado con Reset Manual
 * Description: Turnos para barbería. Cliente/admin/historial, sonidos, reinicio diario (Lun-Sab 09:00), y shortcode [turnos_reset_manual] para limpieza manual.
 * Version: 1.0.0
 * Author: Tu Nombre
 */

if (! defined('ABSPATH')) exit;

/* ------------------------------------------------------------------
   1) Registrar CPT 'turno'
------------------------------------------------------------------ */
function tb_registrar_cpt() {
    register_post_type('turno', array(
        'label' => 'Turnos',
        'public' => false,
        'show_ui' => true,
        'supports' => array('title'),
        'menu_icon' => 'dashicons-groups'
    ));
}
add_action('init','tb_registrar_cpt');

/* ------------------------------------------------------------------
   2) Reinicio diario automático (Lun-Sab a las 09:00)
------------------------------------------------------------------ */
function tb_reiniciar_historial_diario(){
    $hoy = current_time('Y-m-d');
    $dia_semana = intval(date('w', strtotime($hoy))); // 0=domingo
    $ultima_fecha = get_option('tb_historial_fecha', '');
    $hora_actual = current_time('H:i');

    // Solo reiniciar Lunes(1) a Sábado(6), después de 09:00 y si no se reinició hoy
    if ($dia_semana >= 1 && $dia_semana <= 6 && $hora_actual >= '09:00' && $ultima_fecha !== $hoy) {
        $turnos = get_posts(array('post_type'=>'turno','numberposts'=>-1,'fields'=>'ids'));
        if (!empty($turnos)) {
            foreach ($turnos as $tid) wp_delete_post($tid, true);
        }
        update_option('tb_ultimo_turno', 0);
        update_option('tb_historial_fecha', $hoy);
    }
}
add_action('init','tb_reiniciar_historial_diario');

/* ------------------------------------------------------------------
   3) Acciones del cliente (tomar turno / cancelar su turno desde su vista)
------------------------------------------------------------------ */
function tb_cliente_acciones() {
    // Pedir turno
    if ( isset($_POST['tb_tomar_turno']) && ! empty($_POST['tb_nombre']) ) {
        $nombre = sanitize_text_field($_POST['tb_nombre']);
        $ultimo = intval(get_option('tb_ultimo_turno', 0));
        $nuevo = $ultimo + 1;

        $turno_id = wp_insert_post(array(
            'post_type' => 'turno',
            'post_title' => "Turno #{$nuevo} - {$nombre}",
            'post_status' => 'publish'
        ));

        if ($turno_id) {
            update_post_meta($turno_id, '_tb_numero', $nuevo);
            update_post_meta($turno_id, '_tb_nombre', $nombre);
            update_post_meta($turno_id, '_tb_fecha', date('Y-m-d'));
            update_post_meta($turno_id, '_tb_estado', 'pendiente');
            update_post_meta($turno_id, '_tb_tiempo_acumulado', 0);
            update_post_meta($turno_id, '_tb_inicio', 0);
            update_post_meta($turno_id, '_tb_mensaje', 'Esperando turno');
            update_option('tb_ultimo_turno', $nuevo);

            // redirigir incluyendo turno y nombre en la URL para vista cliente
            wp_redirect(add_query_arg(array('turno'=>$nuevo,'nombre'=>urlencode($nombre)), wp_get_referer()));
            exit;
        }
    }

    // Cancelar turno desde la vista del cliente (si viene con ?turno=)
    if ( isset($_POST['tb_cancelar_cliente']) && isset($_GET['turno']) ) {
        $turno_num = intval($_GET['turno']);
        $found = get_posts(array(
            'post_type'=>'turno','numberposts'=>1,
            'meta_key'=>'_tb_numero','meta_value'=>$turno_num
        ));
        if (!empty($found)) {
            $t = $found[0];
            update_post_meta($t->ID,'_tb_estado','cancelado');
            update_post_meta($t->ID,'_tb_inicio',0);
            update_post_meta($t->ID,'_tb_tiempo_acumulado',0);
            update_post_meta($t->ID,'_tb_mensaje','Turno cancelado por el cliente.');
        }
        // redirigir a la misma página sin parámetros para que el cliente vea el formulario otra vez
        wp_redirect(remove_query_arg(array('turno','nombre'), wp_get_referer()));
        exit;
    }
}
add_action('init','tb_cliente_acciones');

/* ------------------------------------------------------------------
   4) AJAX: Admin controla turno (iniciar/detener/cancelar)
      - requiere permisos manage_options y nonce 'tb_admin_nonce'
------------------------------------------------------------------ */
function tb_ajax_admin_turno_control(){
    if (! current_user_can('manage_options')) {
        wp_send_json_error(array('message'=>'No tienes permisos.'));
    }
    if (! isset($_REQUEST['nonce']) || ! wp_verify_nonce($_REQUEST['nonce'],'tb_admin_nonce') ) {
        wp_send_json_error(array('message'=>'Nonce inválido.'));
    }

    $turno_id = isset($_POST['turno_id']) ? intval($_POST['turno_id']) : 0;
    $accion = isset($_POST['accion']) ? sanitize_text_field($_POST['accion']) : '';

    if (!$turno_id || get_post_type($turno_id) != 'turno') {
        wp_send_json_error(array('message'=>'Turno no válido.'));
    }

    switch ($accion) {
        case 'iniciar':
            update_post_meta($turno_id,'_tb_estado','activo');
            update_post_meta($turno_id,'_tb_inicio', time());
            update_post_meta($turno_id,'_tb_mensaje','Tu turno ha iniciado. ¡Prepárate!');
            update_option('tb_turno_actual', get_post_meta($turno_id,'_tb_numero',true));
            break;

        case 'detener':
            $inicio = intval(get_post_meta($turno_id,'_tb_inicio',true));
            $acum = intval(get_post_meta($turno_id,'_tb_tiempo_acumulado',true));
            if ($inicio > 0) $acum += time() - $inicio;
            update_post_meta($turno_id,'_tb_tiempo_acumulado',$acum);
            update_post_meta($turno_id,'_tb_estado','finalizado');
            update_post_meta($turno_id,'_tb_inicio',0);
            update_post_meta($turno_id,'_tb_mensaje','Tu turno ha finalizado.');
            break;

        case 'cancelar':
            update_post_meta($turno_id,'_tb_estado','cancelado');
            update_post_meta($turno_id,'_tb_inicio',0);
            update_post_meta($turno_id,'_tb_tiempo_acumulado',0);
            update_post_meta($turno_id,'_tb_mensaje','Tu turno ha sido cancelado por el administrador por tardar más de 5 minutos.');
            break;

        default:
            wp_send_json_error(array('message'=>'Acción desconocida.'));
    }

    wp_send_json_success(array('message'=>'Acción realizada: '.$accion));
}
add_action('wp_ajax_tb_admin_turno_control','tb_ajax_admin_turno_control');

/* ------------------------------------------------------------------
   5) AJAX: Cliente obtiene estado de su turno (no requiere login)
------------------------------------------------------------------ */
function tb_ajax_cliente_turno_estado(){
    $turno_num = isset($_GET['turno']) ? intval($_GET['turno']) : 0;
    if (!$turno_num) wp_send_json_error(array('message'=>'Turno no especificado'));

    $turno_post = get_posts(array(
        'post_type'=>'turno','meta_key'=>'_tb_numero','meta_value'=>$turno_num,'numberposts'=>1
    ));
    if (empty($turno_post)) wp_send_json_error(array('message'=>'Turno no encontrado'));

    $t = $turno_post[0];
    $estado = get_post_meta($t->ID,'_tb_estado',true);
    $inicio = intval(get_post_meta($t->ID,'_tb_inicio',true));
    $acum = intval(get_post_meta($t->ID,'_tb_tiempo_acumulado',true));
    $mensaje = get_post_meta($t->ID,'_tb_mensaje',true);

    wp_send_json_success(array(
        'estado'=>$estado,
        'inicio'=>$inicio,
        'acumulado'=>$acum,
        'mensaje'=>$mensaje
    ));
}
add_action('wp_ajax_nopriv_tb_cliente_estado','tb_ajax_cliente_turno_estado');
add_action('wp_ajax_tb_cliente_estado','tb_ajax_cliente_turno_estado');

/* ------------------------------------------------------------------
   6) Shortcode [turnos_cliente] - vista cliente
------------------------------------------------------------------ */
function tb_shortcode_cliente(){
    ob_start();

    $dia_semana = intval(date('w')); // 0 domingo
    $hora_actual = current_time('H:i');

    ?>
    <div class="tb-cliente-box">
        <h2>Turnos - Cliente</h2>
        <p><strong>Fecha:</strong> <?php echo date('d/m/Y'); ?></p>

        <?php if ($dia_semana === 0): // DOMINGO ?>
            <div style="padding:10px;border-radius:6px;background:#fff3cd;color:#856404;">
                <strong>Ser administrador ejecute la limpieza del historial de turnos e historial de turnos del día</strong><br>
                😴 Hoy es domingo — la barbería descansa. Vuelve mañana con estilo.
            </div>

        <?php elseif ($hora_actual < '09:00' || $hora_actual > '20:15'): ?>
            <p>⏰ Horario de turnos: Lunes a Sábado 09:00 - 20:15</p>

        <?php elseif ( isset($_GET['turno']) ): // cliente con turno activo en la URL ?>
            <?php $turno = intval($_GET['turno']); $nombre = isset($_GET['nombre']) ? sanitize_text_field(urldecode($_GET['nombre'])) : ''; ?>
            <p>Hola <strong><?php echo esc_html($nombre ?: 'cliente'); ?></strong> — tu turno:</p>
            <div id="tb-turno-num" style="font-size:28px;font-weight:bold;">#<?php echo $turno; ?></div>
            <p id="tb-aviso" style="font-weight:bold;color:blue;">Esperando turno...</p>
            <p>Reloj: <span id="tb-reloj"></span></p>
            <p>Tiempo: <span id="tb-crono">00:00</span></p>

            <form method="post" style="margin-top:10px;">
                <button type="submit" name="tb_cancelar_cliente" class="tb-btn-cancelar">Cancelar mi turno</button>
            </form>

            <!-- sonidos (inicio y fin) -->
            <audio id="tb-sound-start" src="http://sibuscaspiso.es/wp-content/uploads/2025/09/sound-alert-device-turn-on-turn-off-win-done-chakongaudio-174892.mp3" preload="auto"></audio>
            <audio id="tb-sound-end" src="https://actions.google.com/sounds/v1/cartoon/clang_and_wobble.ogg" preload="auto"></audio>

            <script>
            (function(){
                const turno = <?php echo $turno; ?>;
                const relojEl = document.getElementById('tb-reloj');
                const cronoEl = document.getElementById('tb-crono');
                const avisoEl = document.getElementById('tb-aviso');
                const soundStart = document.getElementById('tb-sound-start');
                const soundEnd = document.getElementById('tb-sound-end');

                // reloj
                function tick(){ relojEl.textContent = new Date().toLocaleTimeString(); }
                setInterval(tick,1000); tick();

                // cronómetro (mostrado a partir de datos que devuelve el servidor)
                let acumulado = 0;
                let inicio = 0;
                let estadoPrevio = '';

                function actualizarCrono(){
                    let total = acumulado;
                    if (inicio > 0) total += Math.floor(Date.now()/1000 - inicio);
                    const m = Math.floor(total/60).toString().padStart(2,'0');
                    const s = (total % 60).toString().padStart(2,'0');
                    cronoEl.textContent = m+':'+s;
                }
                setInterval(actualizarCrono,1000);
                actualizarCrono();

                // polling para estado
                function refrescar(){
                    fetch('<?php echo admin_url('admin-ajax.php'); ?>?action=tb_cliente_estado&turno='+turno, {credentials:'same-origin'})
                    .then(r=>r.json()).then(d=>{
                        if (!d.success) return;
                        const data = d.data;
                        // reproducir sonidos cuando cambia a activo o finalizado
                        if (estadoPrevio !== data.estado && data.estado === 'activo'){
                            soundStart.play().catch(()=>{});
                            avisoEl.textContent = '¡Es tu turno!';
                            avisoEl.style.color = 'green';
                        }
                        if (estadoPrevio !== data.estado && data.estado === 'finalizado'){
                            soundEnd.play().catch(()=>{});
                            avisoEl.textContent = 'Turno finalizado.';
                            avisoEl.style.color = 'gray';
                            // después de unos segundos devolvemos al cliente al formulario (sin params)
                            setTimeout(()=>{ window.location.href = window.location.pathname; }, 3500);
                        }
                        if (estadoPrevio !== data.estado && data.estado === 'cancelado'){
                            avisoEl.textContent = data.mensaje || 'Turno cancelado.';
                            avisoEl.style.color = 'red';
                            setTimeout(()=>{ window.location.href = window.location.pathname; }, 3000);
                        }

                        estadoPrevio = data.estado;
                        acumulado = parseInt(data.acumulado) || 0;
                        inicio = parseInt(data.inicio) || 0;

                        if (data.estado === 'pendiente') {
                            avisoEl.textContent = data.mensaje || 'Esperando turno...';
                            avisoEl.style.color = 'blue';
                        }
                    })
                    .catch(err => console.warn('Error refrescar estado:', err));
                }

                refrescar();
                setInterval(refrescar, 3000);
            })();
            </script>

        <?php else: // formulario para pedir turno ?>
            <form method="post" class="tb-form">
                <input type="text" name="tb_nombre" class="tb-input" required placeholder="Tu nombre">
                <button type="submit" name="tb_tomar_turno" class="tb-btn">✂️ Pedir mi turno</button>
            </form>
        <?php endif; ?>
    </div>
    <?php
    return ob_get_clean();
}
add_shortcode('turnos_cliente','tb_shortcode_cliente');

/* ------------------------------------------------------------------
   7) Shortcode [turnos_admin] - panel administrador
------------------------------------------------------------------ */
function tb_shortcode_admin(){
    if (! current_user_can('manage_options') ) return '<p>No tienes permisos.</p>';

    $turnos = get_posts(array('post_type'=>'turno','numberposts'=>-1,'orderby'=>'meta_value_num','meta_key'=>'_tb_numero','order'=>'ASC'));

    ob_start(); ?>
    <div class="tb-admin-box">
        <h2>Panel Administrador</h2>
        <p><strong>Fecha:</strong> <?php echo date('d/m/Y'); ?></p>

        <?php if (empty($turnos)): ?>
            <p>No hay turnos registrados.</p>
        <?php else: ?>
            <table style="width:100%;border-collapse:collapse;">
                <tr style="background:#f1f1f1;"><th>Turno</th><th>Cliente</th><th>Estado</th><th>Acciones</th></tr>
                <?php foreach ($turnos as $t):
                    $id = $t->ID;
                    $num = get_post_meta($id,'_tb_numero',true);
                    $nom = get_post_meta($id,'_tb_nombre',true);
                    $est = get_post_meta($id,'_tb_estado',true);
                ?>
                <tr>
                    <td>#<?php echo esc_html($num); ?></td>
                    <td><?php echo esc_html($nom); ?></td>
                    <td><?php echo esc_html($est); ?></td>
                    <td>
                        <?php if ($est === 'pendiente'): ?>
                            <button class="tb-btn-action" data-id="<?php echo $id;?>" data-accion="iniciar">Iniciar</button>
                        <?php elseif ($est === 'activo'): ?>
                            <button class="tb-btn-action" data-id="<?php echo $id;?>" data-accion="detener">Detener</button>
                        <?php endif; ?>
                        <button class="tb-btn-action" data-id="<?php echo $id;?>" data-accion="cancelar">Cancelar</button>
                    </td>
                </tr>
                <?php endforeach; ?>
            </table>
        <?php endif; ?>
    </div>

    <audio id="tb-sound-admin" src="http://sibuscaspiso.es/wp-content/uploads/2025/09/sound-alert-device-turn-on-turn-off-win-done-chakongaudio-174892.mp3" preload="auto"></audio>

    <script>
    (function(){
        const ajaxUrl = '<?php echo admin_url('admin-ajax.php'); ?>';
        const nonce = '<?php echo wp_create_nonce('tb_admin_nonce'); ?>';
        const botones = document.querySelectorAll('.tb-btn-action');
        function disableBtn(b,d){ b.disabled = d; b.style.opacity = d?0.6:1; }

        botones.forEach(btn => {
            btn.addEventListener('click', function(){
                if (!confirm('Confirmar acción: ' + this.dataset.accion + ' ?')) return;
                const fd = new FormData();
                fd.append('action','tb_admin_turno_control');
                fd.append('nonce', nonce);
                fd.append('turno_id', this.dataset.id);
                fd.append('accion', this.dataset.accion);
                disableBtn(this,true);

                fetch(ajaxUrl, { method:'POST', body: fd, credentials:'same-origin' })
                .then(r => r.json()).then(d => {
                    if (d.success) {
                        document.getElementById('tb-sound-admin').play().catch(()=>{});
                        alert(d.data.message || 'Acción realizada');
                        location.reload();
                    } else {
                        alert('Error: ' + (d.data && d.data.message ? d.data.message : JSON.stringify(d)));
                        disableBtn(this,false);
                    }
                })
                .catch(err=>{
                    console.error('AJAX admin error',err);
                    alert('Error al comunicarse con el servidor.');
                    disableBtn(this,false);
                });
            });
        });
    })();
    </script>
    <?php
    return ob_get_clean();
}
add_shortcode('turnos_admin','tb_shortcode_admin');

/* ------------------------------------------------------------------
   8) Shortcode [turnos_historial] - historial del día con "Ver más"
------------------------------------------------------------------ */
function tb_shortcode_historial(){
    ob_start();
    $hoy = date('Y-m-d');
    $turnos = get_posts(array(
        'post_type'=>'turno',
        'numberposts'=>-1,
        'orderby'=>'meta_value_num',
        'meta_key'=>'_tb_numero',
        'order'=>'ASC',
        'meta_query' => array(array('key'=>'_tb_fecha','value'=>$hoy,'compare'=>'='))
    ));
    ?>
    <div class="tb-historial-box">
        <h3>Historial de hoy (<?php echo date('d/m/Y'); ?>)</h3>
        <?php if (empty($turnos)): ?>
            <p>No hay turnos hoy.</p>
        <?php else: ?>
            <ul id="tb-historial-list">
                <?php foreach ($turnos as $idx => $t):
                    $nro = get_post_meta($t->ID,'_tb_numero',true);
                    $nom = get_post_meta($t->ID,'_tb_nombre',true);
                    $est = get_post_meta($t->ID,'_tb_estado',true);
                    $class = $idx < 8 ? '' : 'tb-hidden-extra';
                ?>
                    <li class="<?php echo $class; ?>">#<?php echo esc_html($nro); ?> — <?php echo esc_html($nom); ?> — <?php echo esc_html($est); ?></li>
                <?php endforeach; ?>
            </ul>
            <?php if (count($turnos) > 8): ?>
                <button id="tb-ver-mas" class="tb-btn">Ver más</button>
            <?php endif; ?>
        <?php endif; ?>
    </div>

    <script>
    (function(){
        const btn = document.getElementById('tb-ver-mas');
        if (!btn) return;
        btn.addEventListener('click', function(){
            document.querySelectorAll('.tb-hidden-extra').forEach(li=>li.classList.remove('tb-hidden-extra'));
            this.style.display = 'none';
        });
    })();
    </script>

    <style>
    .tb-hidden-extra{display:none;}
    </style>
    <?php
    return ob_get_clean();
}
add_shortcode('turnos_historial','tb_shortcode_historial');

/* ------------------------------------------------------------------
   9) Shortcode [turnos_reset_manual] - limpieza manual (admin ONLY)
       - Muestra conteo: cuántos turnos del día y cuántos totales
       - Botones: Limpiar hoy / Limpiar todo
       - Nonce & confirm
       - Guarda log resumido en la opción 'tb_last_reset'
------------------------------------------------------------------ */
function tb_shortcode_reset_manual(){
    if (! current_user_can('manage_options')) return '<p>No tienes permisos.</p>';

    $msg = '';
    $hoy = date('Y-m-d');

    // Procesar POST
    if ( isset($_POST['tb_reset_action']) ) {
        if ( ! isset($_POST['tb_reset_nonce']) || ! wp_verify_nonce($_POST['tb_reset_nonce'],'tb_reset_manual_action') ) {
            $msg = '<p style="color:red;">Nonce inválido. Acción cancelada.</p>';
        } else {
            $accion = sanitize_text_field($_POST['tb_reset_action']);
            $deleted = 0;
            if ($accion === 'dia') {
                // Borrar solo los turnos de hoy
                $ids = get_posts(array('post_type'=>'turno','numberposts'=>-1,'fields'=>'ids','meta_key'=>'_tb_fecha','meta_value'=>$hoy));
                if (!empty($ids)) { foreach($ids as $id) { wp_delete_post($id,true); $deleted++; } }
                update_option('tb_ultimo_turno', 0);
                update_option('tb_historial_fecha', $hoy);
                $msg = "<p style='color:green;'>Se limpiaron {$deleted} turnos del día ({$hoy}).</p>";
            } else { // todo
                $ids = get_posts(array('post_type'=>'turno','numberposts'=>-1,'fields'=>'ids'));
                if (!empty($ids)) { foreach($ids as $id) { wp_delete_post($id,true); $deleted++; } }
                update_option('tb_ultimo_turno', 0);
                update_option('tb_historial_fecha', $hoy);
                $msg = "<p style='color:green;'>Se limpiaron {$deleted} turnos en total.</p>";
            }

            // Guardar log simple
            $log = get_option('tb_last_reset', array());
            $log_entry = array(
                'user_id' => get_current_user_id(),
                'user_login' => wp_get_current_user()->user_login,
                'action' => $accion,
                'deleted_count' => $deleted,
                'when' => current_time('mysql')
            );
            $log[] = $log_entry;
            update_option('tb_last_reset', $log);
        }
    }

    // Contar turnos a mostrar antes de la acción
    $total_ids = get_posts(array('post_type'=>'turno','numberposts'=>-1,'fields'=>'ids'));
    $total_count = is_array($total_ids) ? count($total_ids) : 0;
    $today_ids = get_posts(array('post_type'=>'turno','numberposts'=>-1,'fields'=>'ids','meta_key'=>'_tb_fecha','meta_value'=>$hoy));
    $today_count = is_array($today_ids) ? count($today_ids) : 0;

    ob_start();
    ?>
    <div class="tb-reset-box">
        <p><strong>Ser administrador ejecute la limpieza del historial de turnos e historial de turnos del día</strong></p>
        <?php echo $msg; ?>
        <p>Turnos hoy: <strong><?php echo $today_count; ?></strong> — Turnos totales: <strong><?php echo $total_count; ?></strong></p>

        <form method="post" onsubmit="return confirm('¿Confirmar limpieza? Esta acción no se puede deshacer.');">
            <?php wp_nonce_field('tb_reset_manual_action','tb_reset_nonce'); ?>
            <button type="submit" name="tb_reset_action" value="dia" class="tb-btn">🧹 Limpiar historial del día</button>
            <button type="submit" name="tb_reset_action" value="todo" class="tb-btn">🧹 Limpiar todo el historial</button>
        </form>

        <?php
        // Mostrar último log (hasta 5)
        $log = array_reverse( (array) get_option('tb_last_reset', array()) );
        if (!empty($log)) {
            echo '<h4>Últimas limpiezas</h4><ul>';
            $i=0;
            foreach($log as $entry) {
                if ($i++>=5) break;
                echo '<li>'.esc_html($entry['when']).' — '.esc_html($entry['user_login']).' — '.esc_html($entry['action']).' — eliminados: '.intval($entry['deleted_count']).'</li>';
            }
            echo '</ul>';
        }
        ?>
    </div>
    <?php
    return ob_get_clean();
}
add_shortcode('turnos_reset_manual','tb_shortcode_reset_manual');

/* ------------------------------------------------------------------
   10) Estilos CSS unificados
------------------------------------------------------------------ */
function tb_css_unificado(){
    echo '<style>
    .tb-cliente-box,.tb-admin-box,.tb-historial-box,.tb-reset-box{max-width:900px;margin:18px auto;padding:16px;border:1px solid #e6e6e6;border-radius:8px;background:#fff;}
    .tb-input{width:70%;padding:10px;border:1px solid #ccc;border-radius:6px;margin-right:8px;}
    .tb-btn{padding:8px 12px;border:none;border-radius:6px;background:#0073aa;color:#fff;cursor:pointer;margin-right:6px;}
    .tb-btn:hover{background:#005177;}
    .tb-btn-cancelar{background:#d9534f;}
    .tb-btn-cancelar:hover{background:#b52b27;}
    table{border-collapse:collapse;width:100%;}
    table th, table td{border:1px solid #eee;padding:8px;text-align:center;}
    #tb-aviso{font-weight:bold;}
    </style>';
}
add_action('wp_head','tb_css_unificado');
