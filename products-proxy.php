<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');

// Change this to the WordPress installation URL if the shop is hosted elsewhere.
$storeUrl = 'https://diaryofafarmer.co.uk/farm';
$apiUrl = rtrim($storeUrl, '/') . '/wp-json/wc/store/v1/products?per_page=4&orderby=date&order=desc&catalog_visibility=visible';

if (!function_exists('curl_init')) {
    http_response_code(502);
    echo json_encode(['error' => 'Product connection is unavailable.']);
    exit;
}

$ch = curl_init($apiUrl);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_FOLLOWLOCATION => true,
    CURLOPT_MAXREDIRS => 3,
    CURLOPT_CONNECTTIMEOUT => 5,
    CURLOPT_TIMEOUT => 15,
    CURLOPT_USERAGENT => 'DiaryProductsProxy/1.0',
    CURLOPT_SSL_VERIFYPEER => true,
    CURLOPT_SSL_VERIFYHOST => 2,
]);
$body = curl_exec($ch);
$status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);
$products = is_string($body) ? json_decode($body, true) : null;

if ($status < 200 || $status >= 300 || !is_array($products) || array_values($products) !== $products) {
    http_response_code(502);
    echo json_encode(['error' => 'Unable to fetch products from the store.']);
    exit;
}

echo json_encode(array_slice($products, 0, 4), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
