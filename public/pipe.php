<?php
// Leer el correo entrante desde la entrada estándar
$raw_mail = file_get_contents("php://stdin");

// URL de tu webhook de destino en n8n
$webhook_url = "https://n8n.veimen.net/webhook/email-agent";


// --- FUNCIONES PARA EXTRAER LOS CAMPOS ---

function get_header($header_name, $mail) {
    // Busca la cabecera (ej. Subject:, From:) ignorando mayúsculas/minúsculas
    $header_name_quoted = preg_quote($header_name, '/');
    if (preg_match('/^' . $header_name_quoted . ':\s*(.*)$/mi', $mail, $match)) {
        // Usar mb_decode_mimeheader es mucho más seguro que imap_utf8 en hosting compartido
        return trim(mb_decode_mimeheader($match[1]));
    }
    return '';
}

function get_clean_body($mail) {
    // Separar cabeceras principales del cuerpo del mensaje
    $parts = preg_split("/\r\n\r\n|\n\n/", $mail, 2);
    $body = isset($parts[1]) ? $parts[1] : $mail;

    // Intentar extraer la sección text/plain si el correo es multipartes
    if (preg_match('/Content-Type:\s*text\/plain[^;\r\n]*.*?\r?\n\r?\n(.*?)(?=\r?\n--|$)/s', $body, $match)) {
        $text = $match[1];
    } else {
        // Si no es multipartes, tomamos todo el cuerpo
        $text = $body;
    }

    // Decodificar si viene en formato quoted-printable (=3D, etc.)
    $text = quoted_printable_decode($text);

    return trim($text);
}

// Extraer los datos específicos
$from = get_header('From', $raw_mail);
$subject = get_header('Subject', $raw_mail);
$body = get_clean_body($raw_mail);

// --- CORRECCIÓN: Forzar conversión limpia a UTF-8 para evitar fallos en json_encode ---
$from = mb_convert_encoding($from, 'UTF-8', 'UTF-8, ISO-8859-1, WINDOWS-1252');
$subject = mb_convert_encoding($subject, 'UTF-8', 'UTF-8, ISO-8859-1, WINDOWS-1252');
$body = mb_convert_encoding($body, 'UTF-8', 'UTF-8, ISO-8859-1, WINDOWS-1252');

// Registrar en el log de depuración para verificar qué se extrajo
//$log_msg = date('Y-m-d H:i:s') . " - Parseado -> From: $from | Subject: $subject | Longitud Body: " . strlen($body) . "\n";
//file_put_contents(__DIR__ . '/pipe_debug.log', $log_msg, FILE_APPEND);

// Preparar los datos estructurados en formato JSON
$data = json_encode(array(
    "from" => $from,
    "subject" => $subject,
    "body" => $body
));

// Verificar si hubo error al generar el JSON
//if ($data === false) {
    //file_put_contents(__DIR__ . '/pipe_debug.log', date('Y-m-d H:i:s') . " - ERROR JSON: " . json_last_error_msg() . "\n", FILE_APPEND);
//}

// Enviar mediante cURL al webhook
$ch = curl_init($webhook_url);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_CUSTOMREQUEST, "POST");
curl_setopt($ch, CURLOPT_POSTFIELDS, $data);
curl_setopt($ch, CURLOPT_HTTPHEADER, array(
    'Content-Type: application/json',
    'Content-Length: ' . strlen($data))
);
$response = curl_exec($ch);
$http_code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

// Guardar la respuesta del webhook en el log
//$log_response = date('Y-m-d H:i:s') . " - HTTP Code: $http_code - Response: $response\n";
//file_put_contents(__DIR__ . '/pipe_debug.log', $log_response, FILE_APPEND);
?>