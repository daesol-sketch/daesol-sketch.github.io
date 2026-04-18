<?php
// LG U+ 착신 콜백 → Supabase Edge Function 전달
$supabase_url = 'https://bbnmxwpacdfqvicybhau.supabase.co/functions/v1/call-notify';

// 로그: LG U+가 보내는 모든 파라미터 기록
$log = date('Y-m-d H:i:s') . ' GET=' . json_encode($_GET) . ' POST=' . json_encode($_POST) . "\n";
file_put_contents(__DIR__ . '/call_log.txt', $log, FILE_APPEND);

// GET/POST 모두 처리
$params = array_merge($_POST, $_GET);
$sender   = isset($params['sender'])   ? $params['sender']   : '';
$kind     = isset($params['kind'])     ? $params['kind']     : '1'; // 없으면 기본값 1
$receiver = isset($params['receiver']) ? $params['receiver'] : '';

$query = http_build_query([
    'sender'   => $sender,
    'kind'     => $kind,
    'receiver' => $receiver,
]);

$ch = curl_init($supabase_url . '?' . $query);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_TIMEOUT, 10);
$result = curl_exec($ch);
curl_close($ch);

echo 'ok';
?>
