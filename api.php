<?php
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST");
header("Content-Type: application/json; charset=UTF-8");

$token = $_POST['token'] ?? '';
$content = $_POST['content'] ?? '';
$action = $_POST['action'] ?? 'add'; 
$edit_id = isset($_POST['id']) ? (int)$_POST['id'] : -1; 

if (empty($token) || empty($content)) {
    http_response_code(400);
    die(json_encode(["error" => "Empty data"]));
}

// 替换为你自己的 SHA-256 哈希指纹
// echo -n 'YourRootPwd' | sha256sum     c3f425cd905806aa89d15f7f38e58ec5ec2e606b04ff20c36da52eb647bccc01
$expected_hash = '9cd4a264391e3663e........................';
if (hash('sha256', $token) !== $expected_hash) {
    http_response_code(403);
    die(json_encode(["error" => "Access Denied."]));
}

$dir = __DIR__ . '/blogs';
$file = $dir . '/default.md';
if (!is_dir($dir)) mkdir($dir, 0755, true);

if ($action === 'edit' && $edit_id >= 0) {
    if (file_exists($file)) {
        $full_text = file_get_contents($file);
        $posts = explode('---POST---', $full_text);
        
        if (isset($posts[$edit_id])) {
            $posts[$edit_id] = "\n\n" . trim($content) . "\n\n";
            $new_text = implode('---POST---', $posts);
            file_put_contents($file, $new_text, LOCK_EX);
            echo json_encode(["success" => true, "message" => "Post updated!"]);
        } else {
            http_response_code(404);
            echo json_encode(["error" => "Post ID not found"]);
        }
    }
} else {
    $final_content = "\n\n---POST---\n\n" . trim($content);
    file_put_contents($file, $final_content, FILE_APPEND | LOCK_EX);
    echo json_encode(["success" => true, "message" => "Post created!"]);
}
?>