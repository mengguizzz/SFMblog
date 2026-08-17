<?php
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, GET"); 
header("Content-Type: application/json; charset=UTF-8");
$action = $_REQUEST['action'] ?? '';

if ($action === 'counter') {
    $counter_file = __DIR__ . '/blogs/counter.txt';
    $count = 0;
    if (file_exists($counter_file)) {
        $count = (int)file_get_contents($counter_file);
    }
    $count++;
    file_put_contents($counter_file, (string)$count, LOCK_EX);

    echo json_encode(["success" => true, "count" => $count]);
    exit;
}

$token = $_POST['token'] ?? '';
$action = $_POST['action'] ?? 'add';

if (empty($token)) {
    http_response_code(400);
    die(json_encode(["error" => "Empty Token"]));
}

// TODO: 把这里换成你真实的 64位 哈希指纹！
// eg: echo -n 'YourRootPwd' | sha256sum   c3f425cd905806aa89d15f7f38e58ec5ec2e606b04ff20c36da52eb647bccc01
$expected_hash = 'abcdefg1234567';
if (hash('sha256', $token) !== $expected_hash) {
    http_response_code(403);
    die(json_encode(["error" => "Access Denied."]));
}
if ($action === 'upload') {
    if (!isset($_FILES['image']) || $_FILES['image']['error'] !== UPLOAD_ERR_OK) {
        http_response_code(400);
        die(json_encode(["error" => "No image received or upload error."]));
    }
    $ext = strtolower(pathinfo($_FILES['image']['name'], PATHINFO_EXTENSION));
    $allowed_exts = ['jpg', 'jpeg', 'png', 'gif', 'webp'];
    if (!in_array($ext, $allowed_exts)) {
        http_response_code(400);
        die(json_encode(["error" => "Only jpg, png, gif, webp are allowed."]));
    }
    
    $img_dir = __DIR__ . '/src/images';
    if (!is_dir($img_dir)) mkdir($img_dir, 0755, true);
    
    $filename = 'img_' . time() . '_' . substr(md5(uniqid()), 0, 4) . '.' . $ext;
    $filepath = $img_dir . '/' . $filename;
    
    if (move_uploaded_file($_FILES['image']['tmp_name'], $filepath)) {
        echo json_encode(["success" => true, "url" => "./src/images/" . $filename]);
    } else {
        http_response_code(500);
        echo json_encode(["error" => "Failed to save image."]);
    }
    exit;
}

$content = $_POST['content'] ?? '';
$edit_id = isset($_POST['id']) ? (int)$_POST['id'] : -1;

$blog_dir = __DIR__ . '/blogs';
$file = $blog_dir . '/default.md';
if (!is_dir($blog_dir)) mkdir($blog_dir, 0755, true);

if ($action === 'edit' && $edit_id >= 0) {
    if (file_exists($file)) {
        $full_text = file_get_contents($file);
        $posts = explode('---POST---', $full_text);
        if (isset($posts[$edit_id])) {
            $posts[$edit_id] = "\n\n" . trim($content) . "\n\n";
            file_put_contents($file, implode('---POST---', $posts), LOCK_EX);
            echo json_encode(["success" => true, "message" => "Post updated!"]);
        }
    }
} else {
    $final_content = "\n\n---POST---\n\n" . trim($content);
    file_put_contents($file, $final_content, FILE_APPEND | LOCK_EX);
    echo json_encode(["success" => true, "message" => "Post created!"]);
}
?>
