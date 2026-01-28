#!/usr/bin/env swift
//
// 背景除去ツール（macOS Vision Framework使用）
//
// Copyright (c) 2026 haboshi
// Licensed under the MIT License. See LICENSE file in the project root.
//
// Usage: swift remove-bg.swift input.png output.png
// Requires: macOS 14.0+
//

import Foundation
import CoreImage
import Vision
import AppKit

/// 背景除去ツール（macOS Vision Framework使用）
@available(macOS 14.0, *)
func removeBackground(inputPath: String, outputPath: String) -> Bool {
    // 画像読み込み
    guard let inputImage = NSImage(contentsOfFile: inputPath),
          let cgImage = inputImage.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
        print("エラー: 画像を読み込めません: \(inputPath)")
        return false
    }

    let ciImage = CIImage(cgImage: cgImage)

    // マスク生成リクエスト
    let request = VNGenerateForegroundInstanceMaskRequest()
    let handler = VNImageRequestHandler(ciImage: ciImage, options: [:])

    do {
        try handler.perform([request])

        guard let result = request.results?.first else {
            print("エラー: マスクを生成できません")
            return false
        }

        // マスクを生成
        let mask = try result.generateScaledMaskForImage(
            forInstances: result.allInstances,
            from: handler
        )

        let maskCIImage = CIImage(cvPixelBuffer: mask)

        // マスクを1px収縮（エロージョン）してエッジのマゼンタ残りを除去
        guard let erodeFilter = CIFilter(name: "CIMorphologyMinimum") else {
            print("エラー: エロージョンフィルタを作成できません")
            return false
        }
        erodeFilter.setValue(maskCIImage, forKey: kCIInputImageKey)
        erodeFilter.setValue(1.0, forKey: kCIInputRadiusKey)  // 1px収縮

        guard let erodedMask = erodeFilter.outputImage else {
            print("エラー: マスク収縮に失敗")
            return false
        }

        // マスクを適用して背景を透過
        let context = CIContext()

        // ブレンドフィルタでマスク適用
        guard let blendFilter = CIFilter(name: "CIBlendWithMask") else {
            print("エラー: フィルタを作成できません")
            return false
        }

        // 透明な背景
        let transparentBackground = CIImage(color: CIColor(red: 0, green: 0, blue: 0, alpha: 0))
            .cropped(to: ciImage.extent)

        blendFilter.setValue(ciImage, forKey: kCIInputImageKey)
        blendFilter.setValue(transparentBackground, forKey: kCIInputBackgroundImageKey)
        blendFilter.setValue(erodedMask, forKey: kCIInputMaskImageKey)

        guard let outputCIImage = blendFilter.outputImage else {
            print("エラー: 出力画像を生成できません")
            return false
        }

        // PNG形式で保存
        guard let cgOutput = context.createCGImage(outputCIImage, from: outputCIImage.extent) else {
            print("エラー: CGImageを作成できません")
            return false
        }

        let bitmapRep = NSBitmapImageRep(cgImage: cgOutput)
        guard let pngData = bitmapRep.representation(using: .png, properties: [:]) else {
            print("エラー: PNGデータを作成できません")
            return false
        }

        try pngData.write(to: URL(fileURLWithPath: outputPath))
        print("背景除去完了: \(outputPath)")
        return true

    } catch {
        print("エラー: \(error.localizedDescription)")
        return false
    }
}

// メイン処理
func main() {
    let args = CommandLine.arguments

    if args.count < 3 {
        print("使用方法: swift remove-bg.swift <入力画像> <出力画像>")
        print("例: swift remove-bg.swift input.png output.png")
        exit(1)
    }

    let inputPath = args[1]
    let outputPath = args[2]

    if #available(macOS 14.0, *) {
        let success = removeBackground(inputPath: inputPath, outputPath: outputPath)
        exit(success ? 0 : 1)
    } else {
        print("エラー: macOS 14.0以降が必要です")
        exit(1)
    }
}

main()
