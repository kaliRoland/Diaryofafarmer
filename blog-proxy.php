<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');

$blogSourceUrl = 'https://diaryofafarmer.co.uk/farm';
$wpApiUrl = 'https://diaryofafarmer.co.uk/wp-json/wp/v2/posts?per_page=3&_embed';
$feedUrl = $blogSourceUrl . '/feed/';

function send_json(int $status, array $payload): void
{
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function fetch_url(string $url): ?string
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
        CURLOPT_USERAGENT => 'DiaryBlogProxy/1.0',
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
    ]);

    $body = curl_exec($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if (!is_string($body) || $status < 200 || $status >= 300) {
        return null;
    }

    return $body;
}

function clean_text(string $text): string
{
    $stripped = strip_tags($text);
    $decoded = html_entity_decode($stripped, ENT_QUOTES | ENT_HTML5, 'UTF-8');
    $singleSpace = preg_replace('/\s+/u', ' ', $decoded);
    return trim((string) $singleSpace);
}

function truncate_text(string $text, int $maxLen): string
{
    if (mb_strlen($text, 'UTF-8') <= $maxLen) {
        return $text;
    }
    return rtrim(mb_substr($text, 0, $maxLen, 'UTF-8')) . '...';
}

function parse_wp_posts(string $jsonBody, string $fallbackUrl): array
{
    $decoded = json_decode($jsonBody, true);
    if (!is_array($decoded)) {
        return [];
    }

    $posts = [];
    foreach ($decoded as $post) {
        $title = clean_text((string) ($post['title']['rendered'] ?? 'Untitled Post'));
        $excerptRaw = (string) ($post['excerpt']['rendered'] ?? '');
        $excerpt = truncate_text(clean_text($excerptRaw), 180);
        $url = (string) ($post['link'] ?? $fallbackUrl);
        $date = (string) ($post['date'] ?? '');
        $image = (string) ($post['_embedded']['wp:featuredmedia'][0]['source_url'] ?? '');

        $posts[] = [
            'title' => $title !== '' ? $title : 'Untitled Post',
            'excerpt' => $excerpt,
            'url' => $url,
            'date' => $date,
            'image' => $image,
        ];
    }

    return array_slice($posts, 0, 3);
}

function parse_rss_posts(string $xmlBody, string $fallbackUrl): array
{
    libxml_use_internal_errors(true);
    $xml = simplexml_load_string($xmlBody);
    if ($xml === false || !isset($xml->channel->item)) {
        return [];
    }

    $posts = [];
    foreach ($xml->channel->item as $item) {
        $title = clean_text((string) ($item->title ?? 'Untitled Post'));
        $excerpt = truncate_text(clean_text((string) ($item->description ?? '')), 180);
        $url = trim((string) ($item->link ?? $fallbackUrl));
        $date = (string) ($item->pubDate ?? '');

        $posts[] = [
            'title' => $title !== '' ? $title : 'Untitled Post',
            'excerpt' => $excerpt,
            'url' => $url !== '' ? $url : $fallbackUrl,
            'date' => $date,
            'image' => '',
        ];
    }

    return array_slice($posts, 0, 3);
}

$wpBody = fetch_url($wpApiUrl);
if (is_string($wpBody)) {
    $wpPosts = parse_wp_posts($wpBody, $blogSourceUrl);
    if (!empty($wpPosts)) {
        send_json(200, $wpPosts);
    }
}

$feedBody = fetch_url($feedUrl);
if (is_string($feedBody)) {
    $rssPosts = parse_rss_posts($feedBody, $blogSourceUrl);
    if (!empty($rssPosts)) {
        send_json(200, $rssPosts);
    }
}

send_json(502, [
    'error' => 'Unable to fetch blog posts from remote source.'
]);

