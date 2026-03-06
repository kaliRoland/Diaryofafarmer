<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');

const MAX_FILE_SIZE = 5242880; // 5 MB
const ALLOWED_EXTENSIONS = ['pdf', 'jpg', 'jpeg', 'png'];
const DEFAULT_CONSULTATION_LEAD_EMAIL = 'solomon@diaryofafarmer.co.uk';

function send_json(int $status, array $payload): void
{
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function clean_text(string $value, int $maxLength = 2000): string
{
    $normalized = trim(preg_replace('/\s+/u', ' ', $value) ?? '');
    $sanitized = strip_tags($normalized);
    if (mb_strlen($sanitized, 'UTF-8') <= $maxLength) {
        return $sanitized;
    }
    return mb_substr($sanitized, 0, $maxLength, 'UTF-8');
}

function validate_email(string $value): string
{
    $email = clean_text($value, 254);
    return filter_var($email, FILTER_VALIDATE_EMAIL) ? $email : '';
}

function env_value(string $key, string $default = ''): string
{
    static $env = null;

    if ($env === null) {
        $env = [];
        $envPath = __DIR__ . '/.env';
        if (is_file($envPath) && is_readable($envPath)) {
            $parsed = parse_ini_file($envPath, false, INI_SCANNER_RAW);
            if (is_array($parsed)) {
                foreach ($parsed as $envKey => $envValue) {
                    if (is_string($envKey) && is_string($envValue)) {
                        $env[$envKey] = trim($envValue);
                    }
                }
            }
        }
    }

    if (isset($env[$key]) && is_string($env[$key]) && $env[$key] !== '') {
        return $env[$key];
    }

    return $default;
}

function build_payload(string $formType): array
{
    $payload = [
        'form_type' => $formType,
        'timestamp_utc' => gmdate('c'),
        'ip' => $_SERVER['REMOTE_ADDR'] ?? '',
        'user_agent' => clean_text($_SERVER['HTTP_USER_AGENT'] ?? '', 400),
    ];

    foreach ($_POST as $key => $value) {
        if ($key === 'form_type') {
            continue;
        }

        if (!is_string($key)) {
            continue;
        }

        if (is_string($value)) {
            $payload[$key] = clean_text($value);
        }
    }

    return $payload;
}

function store_upload_if_present(): ?array
{
    if (!isset($_FILES['file-upload']) || !is_array($_FILES['file-upload'])) {
        return null;
    }

    $file = $_FILES['file-upload'];
    $error = (int) ($file['error'] ?? UPLOAD_ERR_NO_FILE);
    if ($error === UPLOAD_ERR_NO_FILE) {
        return null;
    }

    if ($error !== UPLOAD_ERR_OK) {
        send_json(422, ['ok' => false, 'error' => 'File upload failed.']);
    }

    $tmpName = (string) ($file['tmp_name'] ?? '');
    $originalName = (string) ($file['name'] ?? 'upload.bin');
    $size = (int) ($file['size'] ?? 0);

    if (!is_uploaded_file($tmpName)) {
        send_json(422, ['ok' => false, 'error' => 'Invalid uploaded file.']);
    }

    if ($size <= 0 || $size > MAX_FILE_SIZE) {
        send_json(422, ['ok' => false, 'error' => 'Uploaded file exceeds 5MB limit.']);
    }

    $extension = strtolower(pathinfo($originalName, PATHINFO_EXTENSION));
    if (!in_array($extension, ALLOWED_EXTENSIONS, true)) {
        send_json(422, ['ok' => false, 'error' => 'Unsupported file type.']);
    }

    $storageDir = __DIR__ . '/storage/uploads';
    if (!is_dir($storageDir) && !mkdir($storageDir, 0775, true) && !is_dir($storageDir)) {
        send_json(500, ['ok' => false, 'error' => 'Unable to prepare upload storage.']);
    }

    $targetName = date('Ymd_His') . '_' . bin2hex(random_bytes(6)) . '.' . $extension;
    $targetPath = $storageDir . '/' . $targetName;

    if (!move_uploaded_file($tmpName, $targetPath)) {
        send_json(500, ['ok' => false, 'error' => 'Unable to store uploaded file.']);
    }

    return [
        'original_name' => clean_text($originalName, 120),
        'stored_name' => $targetName,
        'size_bytes' => $size,
    ];
}

function smtp_read_response($socket): string
{
    $response = '';
    while (($line = fgets($socket, 515)) !== false) {
        $response .= $line;
        if (strlen($line) >= 4 && $line[3] === ' ') {
            break;
        }
    }
    return $response;
}

function smtp_expect($socket, array $expectedCodes): bool
{
    $response = smtp_read_response($socket);
    if ($response === '' || strlen($response) < 3) {
        return false;
    }

    $code = (int) substr($response, 0, 3);
    return in_array($code, $expectedCodes, true);
}

function smtp_write_line($socket, string $line): bool
{
    return fwrite($socket, $line . "\r\n") !== false;
}

function smtp_send_message(
    string $smtpHost,
    int $smtpPort,
    string $encryption,
    string $smtpUser,
    string $smtpPass,
    string $from,
    string $to,
    string $subject,
    string $body,
    string $replyTo
): bool {
    $timeout = (int) env_value('SMTP_TIMEOUT', '15');
    if ($timeout < 5) {
        $timeout = 5;
    }

    $transportHost = $encryption === 'ssl' ? 'ssl://' . $smtpHost : $smtpHost;
    $socket = @stream_socket_client(
        $transportHost . ':' . $smtpPort,
        $errno,
        $errstr,
        $timeout,
        STREAM_CLIENT_CONNECT
    );

    if (!is_resource($socket)) {
        return false;
    }

    stream_set_timeout($socket, $timeout);

    if (!smtp_expect($socket, [220])) {
        fclose($socket);
        return false;
    }

    $clientName = preg_replace('/[^a-zA-Z0-9.-]/', '', gethostname() ?: 'localhost') ?: 'localhost';

    if (!smtp_write_line($socket, 'EHLO ' . $clientName) || !smtp_expect($socket, [250])) {
        fclose($socket);
        return false;
    }

    if ($encryption === 'starttls') {
        if (!smtp_write_line($socket, 'STARTTLS') || !smtp_expect($socket, [220])) {
            fclose($socket);
            return false;
        }

        if (!stream_socket_enable_crypto($socket, true, STREAM_CRYPTO_METHOD_TLS_CLIENT)) {
            fclose($socket);
            return false;
        }

        if (!smtp_write_line($socket, 'EHLO ' . $clientName) || !smtp_expect($socket, [250])) {
            fclose($socket);
            return false;
        }
    }

    if ($smtpUser !== '') {
        if (!smtp_write_line($socket, 'AUTH LOGIN') || !smtp_expect($socket, [334])) {
            fclose($socket);
            return false;
        }

        if (!smtp_write_line($socket, base64_encode($smtpUser)) || !smtp_expect($socket, [334])) {
            fclose($socket);
            return false;
        }

        if (!smtp_write_line($socket, base64_encode($smtpPass)) || !smtp_expect($socket, [235])) {
            fclose($socket);
            return false;
        }
    }

    if (!smtp_write_line($socket, 'MAIL FROM:<' . $from . '>') || !smtp_expect($socket, [250])) {
        fclose($socket);
        return false;
    }

    if (!smtp_write_line($socket, 'RCPT TO:<' . $to . '>') || !smtp_expect($socket, [250, 251])) {
        fclose($socket);
        return false;
    }

    if (!smtp_write_line($socket, 'DATA') || !smtp_expect($socket, [354])) {
        fclose($socket);
        return false;
    }

    $headers = [
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=UTF-8',
        'From: Diary of a Farmer <' . $from . '>',
        'Reply-To: ' . $replyTo,
        'To: <' . $to . '>',
        'Subject: ' . $subject,
    ];

    $data = implode("\r\n", $headers) . "\r\n\r\n" . $body;
    $data = str_replace(["\r\n.", "\n.", "\r."], ["\r\n..", "\n..", "\r.."], $data);

    if (fwrite($socket, $data . "\r\n.\r\n") === false || !smtp_expect($socket, [250])) {
        fclose($socket);
        return false;
    }

    smtp_write_line($socket, 'QUIT');
    fclose($socket);
    return true;
}

function deliver_consultation_lead_email(array $entry): bool
{
    $to = validate_email(env_value('CONSULTATION_LEADS_EMAIL', DEFAULT_CONSULTATION_LEAD_EMAIL));
    if ($to === '') {
        return false;
    }

    $subject = 'New Consultation Lead - ' . ($entry['name'] ?? 'Unknown');

    $lines = [
        'A new consultation lead was submitted.',
        '',
        'Submitted at (UTC): ' . ($entry['timestamp_utc'] ?? ''),
        'Name: ' . ($entry['name'] ?? ''),
        'Email: ' . ($entry['email'] ?? ''),
        'Phone: ' . ($entry['phone'] ?? ''),
        'Country: ' . ($entry['country'] ?? ''),
        'Service Type: ' . ($entry['service-type'] ?? ''),
        'Package: ' . ($entry['package'] ?? ''),
        'Consultation Method: ' . ($entry['consultation-method'] ?? ''),
        'Urgency: ' . ($entry['urgency'] ?? ''),
        'Referral: ' . ($entry['referral'] ?? ''),
        '',
        'IP: ' . ($entry['ip'] ?? ''),
        'User Agent: ' . ($entry['user_agent'] ?? ''),
    ];

    if (isset($entry['upload']) && is_array($entry['upload'])) {
        $lines[] = '';
        $lines[] = 'Upload:';
        $lines[] = 'Original Name: ' . ($entry['upload']['original_name'] ?? '');
        $lines[] = 'Stored Name: ' . ($entry['upload']['stored_name'] ?? '');
        $lines[] = 'Size (bytes): ' . (string) ($entry['upload']['size_bytes'] ?? '');
    }

    $from = validate_email(env_value('MAIL_FROM', ''));
    if ($from === '') {
        $host = clean_text((string) ($_SERVER['HTTP_HOST'] ?? ''), 200);
        $host = preg_replace('/:\d+$/', '', $host) ?: 'localhost';
        $from = 'no-reply@' . $host;
    }

    $smtpHost = clean_text(env_value('SMTP_HOST', ''), 255);
    if ($smtpHost === '') {
        return false;
    }

    $smtpPort = (int) env_value('SMTP_PORT', '587');
    if ($smtpPort <= 0 || $smtpPort > 65535) {
        $smtpPort = 587;
    }

    $smtpEncryption = strtolower(clean_text(env_value('SMTP_ENCRYPTION', 'starttls'), 20));
    if (!in_array($smtpEncryption, ['starttls', 'ssl', 'none'], true)) {
        $smtpEncryption = 'starttls';
    }

    return smtp_send_message(
        $smtpHost,
        $smtpPort,
        $smtpEncryption,
        clean_text(env_value('SMTP_USERNAME', ''), 254),
        env_value('SMTP_PASSWORD', ''),
        $from,
        $to,
        $subject,
        implode(PHP_EOL, $lines),
        (string) ($entry['email'] ?? $from)
    );
}

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    send_json(405, ['ok' => false, 'error' => 'Method not allowed']);
}

$formType = clean_text((string) ($_POST['form_type'] ?? ''), 40);
if (!in_array($formType, ['contact', 'consultation'], true)) {
    send_json(422, ['ok' => false, 'error' => 'Invalid form type.']);
}

$name = clean_text((string) ($_POST['name'] ?? ''), 160);
$email = validate_email((string) ($_POST['email'] ?? ''));
$agreement = isset($_POST['agreement']) || isset($_POST['consent']);

if ($name === '' || $email === '') {
    send_json(422, ['ok' => false, 'error' => 'Name and valid email are required.']);
}

if (!$agreement) {
    send_json(422, ['ok' => false, 'error' => 'Consent confirmation is required.']);
}

$entry = build_payload($formType);
$entry['name'] = $name;
$entry['email'] = $email;
$entry['upload'] = store_upload_if_present();

$storageDir = __DIR__ . '/storage';
if (!is_dir($storageDir) && !mkdir($storageDir, 0775, true) && !is_dir($storageDir)) {
    send_json(500, ['ok' => false, 'error' => 'Unable to prepare submission storage.']);
}

$logPath = $storageDir . '/submissions.jsonl';
$line = json_encode($entry, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
if (!is_string($line) || file_put_contents($logPath, $line . PHP_EOL, FILE_APPEND | LOCK_EX) === false) {
    send_json(500, ['ok' => false, 'error' => 'Unable to save submission.']);
}

if ($formType === 'consultation' && !deliver_consultation_lead_email($entry)) {
    send_json(500, ['ok' => false, 'error' => 'Submission saved but lead email delivery failed.']);
}

send_json(200, ['ok' => true]);
