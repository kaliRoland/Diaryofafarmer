<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');

load_env_file(__DIR__ . '/.env');

// WooCommerce API credentials
// Generate these in WordPress: WooCommerce > Settings > Advanced > REST API
$consumer_key = getenv('WOO_CONSUMER_KEY') ?: '';
$consumer_secret = getenv('WOO_CONSUMER_SECRET') ?: '';
$wordpress_url = rtrim(getenv('WORDPRESS_URL') ?: 'https://diaryofafarmer.co.uk/farm', '/');
$keys_configured = $consumer_key !== '' && $consumer_secret !== ''
    && !str_starts_with($consumer_key, 'replace_with_')
    && !str_starts_with($consumer_secret, 'replace_with_');

// WooCommerce API endpoint
$api_url = $wordpress_url . '/wp-json/wc/v3/products';
$store_api_url = $wordpress_url . '/wp-json/wc/store/v1/products';

function send_json(int $status, array $payload): void
{
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function fetch_woo_products(string $url, string $key, string $secret): ?array
{
    if (!function_exists('curl_init')) {
        return null;
    }

    // Build the basic auth header for WooCommerce API
    $auth = base64_encode($key . ':' . $secret);

    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_CONNECTTIMEOUT => 8,
        CURLOPT_TIMEOUT => 15,
        CURLOPT_USERAGENT => 'DiaryProductsProxy/1.0',
        CURLOPT_HTTPHEADER => [
            'Authorization: Basic ' . $auth,
            'Content-Type: application/json'
        ],
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
    ]);

    $response = curl_exec($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if (!is_string($response) || $status < 200 || $status >= 300) {
        return null;
    }

    $data = json_decode($response, true);
    return is_array($data) ? $data : null;
}

function fetch_public_store_products(string $url): ?array
{
    if (!function_exists('curl_init')) {
        return null;
    }

    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_CONNECTTIMEOUT => 8,
        CURLOPT_TIMEOUT => 15,
        CURLOPT_USERAGENT => 'DiaryProductsProxy/1.0',
        CURLOPT_HTTPHEADER => [
            'Content-Type: application/json'
        ],
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
    ]);

    $response = curl_exec($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if (!is_string($response) || $status < 200 || $status >= 300) {
        return null;
    }

    $data = json_decode($response, true);
    return is_array($data) ? $data : null;
}

function normalize_store_price($rawPrice, int $minorUnit): string
{
    if (!is_scalar($rawPrice)) {
        return '0';
    }

    $value = (string) $rawPrice;
    if ($value === '' || !is_numeric($value)) {
        return '0';
    }

    $minor = max(0, $minorUnit);
    $number = (float) $value;

    if ($minor > 0) {
        $number = $number / (10 ** $minor);
    }

    return number_format($number, 2, '.', '');
}

function format_product(array $product): array
{
    if (isset($product['prices']) && is_array($product['prices'])) {
        $prices = $product['prices'];
        $minorUnit = (int) ($prices['currency_minor_unit'] ?? 2);

        return [
            'id' => $product['id'] ?? 0,
            'title' => $product['name'] ?? 'Untitled Product',
            'description' => $product['short_description'] ?? $product['description'] ?? '',
            'price' => normalize_store_price($prices['price'] ?? '0', $minorUnit),
            'regular_price' => normalize_store_price($prices['regular_price'] ?? $prices['price'] ?? '0', $minorUnit),
            'sale_price' => normalize_store_price($prices['sale_price'] ?? '', $minorUnit),
            'image' => $product['images'][0]['src'] ?? '',
            'url' => $product['permalink'] ?? ''
        ];
    }

    return [
        'id' => $product['id'] ?? 0,
        'title' => $product['name'] ?? 'Untitled Product',
        'description' => $product['short_description'] ?? $product['description'] ?? '',
        'price' => $product['price'] ?? '0',
        'regular_price' => $product['regular_price'] ?? $product['price'] ?? '0',
        'sale_price' => $product['sale_price'] ?? null,
        'image' => $product['images'][0]['src'] ?? '',
        'url' => $product['permalink'] ?? ''
    ];
}

// Build query parameters
$params = [
    'per_page' => max(1, min(20, intval($_GET['per_page'] ?? 4))),
    'orderby' => sanitize_text($_GET['orderby'] ?? 'date'),
    'order' => sanitize_text($_GET['order'] ?? 'desc'),
    'status' => 'publish'
];

$query_string = http_build_query($params);
$url = $api_url . '?' . $query_string;

// Try authenticated WooCommerce REST API first when keys are configured.
$products = null;
if ($keys_configured) {
    $products = fetch_woo_products($url, $consumer_key, $consumer_secret);
}

// Fallback to the public WooCommerce Store API.
if ($products === null) {
    $storeParams = [
        'per_page' => $params['per_page'],
        'orderby' => $params['orderby'],
        'order' => $params['order']
    ];
    $storeUrl = $store_api_url . '?' . http_build_query($storeParams);
    $products = fetch_public_store_products($storeUrl);
}

if ($products === null) {
    send_json(502, [
        'error' => 'Failed to fetch products from WooCommerce',
        'message' => 'Unable to reach either WooCommerce REST API or Store API'
    ]);
}

// Filter and format product data
$formatted_products = array_map(static fn($product) => format_product((array) $product), $products);

send_json(200, $formatted_products);

function sanitize_text(string $input): string
{
    return preg_replace('/[^a-zA-Z0-9_-]/', '', $input);
}

function load_env_file(string $path): void
{
    if (!is_file($path) || !is_readable($path)) {
        return;
    }

    $lines = file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    if (!is_array($lines)) {
        return;
    }

    foreach ($lines as $line) {
        $trimmed = trim($line);
        if ($trimmed === '' || str_starts_with($trimmed, '#')) {
            continue;
        }

        $parts = explode('=', $trimmed, 2);
        if (count($parts) !== 2) {
            continue;
        }

        $name = trim($parts[0]);
        $value = trim($parts[1]);
        if ($name === '') {
            continue;
        }

        if (
            (str_starts_with($value, '"') && str_ends_with($value, '"')) ||
            (str_starts_with($value, "'") && str_ends_with($value, "'"))
        ) {
            $value = substr($value, 1, -1);
        }

        putenv($name . '=' . $value);
        $_ENV[$name] = $value;
        $_SERVER[$name] = $value;
    }
}
