package com.yesolve.click;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.util.Log;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

public class FileSaveActivity extends Activity {

    private static final String TAG = "FileSaveActivity";
    private static final int REQ_CREATE_FILE = 2001;

    private String pendingContent;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        String fileName = getIntent().getStringExtra("fileName");
        String tempPath = getIntent().getStringExtra("tempPath");

        // 主要流程：內容先由呼叫端寫入快取暫存檔（避免 bundle 過大超出 Intent extra 限制）
        if (tempPath != null && !tempPath.isEmpty()) {
            pendingContent = readTempFile(tempPath);
            try {
                new File(tempPath).delete();
            } catch (Exception ignored) {}
        }
        // 舊版相容：直接以 extra 傳內容
        if (pendingContent == null) {
            pendingContent = getIntent().getStringExtra("content");
        }

        if (fileName == null || fileName.trim().isEmpty()) {
            fileName = "script.json";
        }

        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("application/json");
        intent.putExtra(Intent.EXTRA_TITLE, fileName);

        try {
            startActivityForResult(intent, REQ_CREATE_FILE);
        } catch (Exception e) {
            Log.e(TAG, "Failed to start create document", e);
            finish();
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);

        if (requestCode == REQ_CREATE_FILE && resultCode == RESULT_OK && data != null && pendingContent != null) {
            Uri uri = data.getData();
            if (uri != null) {
                try (OutputStream out = getContentResolver().openOutputStream(uri)) {
                    if (out != null) {
                        out.write(pendingContent.getBytes(StandardCharsets.UTF_8));
                        out.flush();
                    }
                } catch (Exception e) {
                    Log.e(TAG, "Failed to write file", e);
                }
            }
        }

        finish();
    }

    private String readTempFile(String path) {
        try (FileInputStream fin = new FileInputStream(path);
             BufferedReader reader = new BufferedReader(new InputStreamReader(fin, StandardCharsets.UTF_8))) {
            StringBuilder sb = new StringBuilder();
            char[] buf = new char[8192];
            int len;
            while ((len = reader.read(buf)) != -1) {
                sb.append(buf, 0, len);
            }
            return sb.toString();
        } catch (Exception e) {
            Log.e(TAG, "Failed to read temp file", e);
            return null;
        }
    }
}
