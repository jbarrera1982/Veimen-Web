<?php
// Leer el correo entrante desde la entrada estándar
$raw_mail = file_get_contents("php://stdin");

// URL de tu webhook de destino en n8n
$webhook_url = "https://n8n.veimen.net/webhook/email-agent";


// ============================================================
// FUNCIONES
// ============================================================

function get_header($header_name, $mail) {

    $header_name_quoted = preg_quote($header_name, '/');

    if (preg_match('/^' . $header_name_quoted . ':\s*(.*)$/mi', $mail, $match)) {

        return trim(mb_decode_mimeheader($match[1]));
    }

    return '';
}


// ============================================================
// EXTRAER BODY TEXT/PLAIN Y BODY HTML
// ============================================================

function get_bodies($mail) {

    // Separar headers principales del body
    $parts = preg_split("/\r\n\r\n|\n\n/", $mail, 2);

    $body = isset($parts[1]) ? $parts[1] : $mail;

    $text_plain = '';
    $text_html = '';

    // --------------------------------------------------------
    // Buscar text/plain
    // --------------------------------------------------------

    if (preg_match(
        '/Content-Type:\s*text\/plain[^;\r\n]*.*?\r?\n\r?\n(.*?)(?=\r?\n--|$)/is',
        $body,
        $match
    )) {

        $text_plain = $match[1];

        // Decodificar quoted-printable
        $text_plain = quoted_printable_decode($text_plain);

        // Decodificar Base64 si corresponde
        if (preg_match('/Content-Transfer-Encoding:\s*base64/i', $match[0])) {
            $text_plain = base64_decode($match[1]);
        }

        $text_plain = trim($text_plain);
    }


    // --------------------------------------------------------
    // Buscar text/html
    // --------------------------------------------------------

    if (preg_match(
        '/Content-Type:\s*text\/html[^;\r\n]*.*?\r?\n\r?\n(.*?)(?=\r?\n--|$)/is',
        $body,
        $match
    )) {

        $text_html = $match[1];

        // Decodificar quoted-printable
        $text_html = quoted_printable_decode($text_html);

        // Decodificar Base64 si corresponde
        if (preg_match('/Content-Transfer-Encoding:\s*base64/i', $match[0])) {
            $text_html = base64_decode($match[1]);
        }

        $text_html = trim($text_html);
    }


    // --------------------------------------------------------
    // Si no encontramos text/plain
    // pero el correo no es multipart,
    // usar el body como texto
    // --------------------------------------------------------

    if (empty($text_plain) && empty($text_html)) {

        $text_plain = quoted_printable_decode($body);

        $text_plain = trim($text_plain);
    }


    // --------------------------------------------------------
    // Si solo existe HTML, generar también texto plano
    // --------------------------------------------------------

    if (empty($text_plain) && !empty($text_html)) {

        $text_plain = strip_tags($text_html);

        // Convertir entidades HTML
        $text_plain = html_entity_decode(
            $text_plain,
            ENT_QUOTES | ENT_HTML5,
            'UTF-8'
        );

        // Limpiar espacios
        $text_plain = preg_replace('/\s+/', ' ', $text_plain);

        $text_plain = trim($text_plain);
    }


    return array(
        'text' => $text_plain,
        'html' => $text_html
    );
}


// ============================================================
// EXTRAER DATOS
// ============================================================

$from = get_header('From', $raw_mail);

$subject = get_header('Subject', $raw_mail);


// Obtener ambos cuerpos
$bodies = get_bodies($raw_mail);

$body = $bodies['text'];
$body_html = $bodies['html'];


// ============================================================
// MESSAGE-ID
// ============================================================

$message_id = get_header('Message-ID', $raw_mail);

$message_id = trim($message_id, '<>');

if (empty($message_id)) {
    $message_id = uniqid();
}


// ============================================================
// FECHA DEL CORREO
// ============================================================

$date_header = get_header('Date', $raw_mail);

try {

    if (!empty($date_header)) {

        $dateTime = new DateTime($date_header);

    } else {

        $dateTime = new DateTime('now');
    }

} catch (Exception $e) {

    $dateTime = new DateTime('now');
}


// Formato ISO 8601 con milisegundos
$receipt_date = $dateTime->format('Y-m-d\TH:i:s.vP');


// ============================================================
// CONVERSIÓN UTF-8
// ============================================================

$from = mb_convert_encoding(
    $from,
    'UTF-8',
    'UTF-8, ISO-8859-1, WINDOWS-1252'
);

$subject = mb_convert_encoding(
    $subject,
    'UTF-8',
    'UTF-8, ISO-8859-1, WINDOWS-1252'
);

$body = mb_convert_encoding(
    $body,
    'UTF-8',
    'UTF-8, ISO-8859-1, WINDOWS-1252'
);

$body_html = mb_convert_encoding(
    $body_html,
    'UTF-8',
    'UTF-8, ISO-8859-1, WINDOWS-1252'
);


// ============================================================
// JSON
// ============================================================

$data = json_encode(
    array(
        "message_id" => $message_id,
        "receipt_date" => $receipt_date,
        "from" => $from,
        "subject" => $subject,

        // Texto plano
        "body" => $body,

        // HTML original
        "body_html" => $body_html
    ),
    JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES
);


// ============================================================
// ENVIAR A N8N
// ============================================================

$ch = curl_init($webhook_url);

curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_CUSTOMREQUEST, "POST");

curl_setopt($ch, CURLOPT_POSTFIELDS, $data);

curl_setopt(
    $ch,
    CURLOPT_HTTPHEADER,
    array(
        'Content-Type: application/json',
        'Content-Length: ' . strlen($data)
    )
);

$response = curl_exec($ch);

$http_code = curl_getinfo($ch, CURLINFO_HTTP_CODE);

curl_close($ch);

?>