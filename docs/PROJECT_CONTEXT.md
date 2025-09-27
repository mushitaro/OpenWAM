# プロジェクトコンテキスト (Project Context)

## 1. プロジェクト概要

このプロジェクトの最終目標は、C++ベースのエンジンシミュレーションツール「OpenWAM」を、Web技術（WebAssembly, React）を用いてインタラクティブなWebアプリケーションへと進化させることです。

## 2. 現在の開発ステージ

現在は、最終目標に向けた**ステージ1：Pythonによる物理モデルのプロトタイピング**の段階です。
`engine_simulator`ディレクトリ以下で、特定のエンジン（BMW E46 M3）を対象としたシミュレーションモデルの構築と検証を進めています。

## 3. AIエージェントへの指示

新しいセッションを開始する際は、まずこの`PROJECT_CONTEXT.md`ファイルの内容を確認してください。
その後、以下の主要ドキュメントへのリンクを辿り、プロジェクトの全体像、これまでの経緯、そして現在の具体的なタスクを把握した上で、作業を再開してください。

## 4. 主要ドキュメント一覧

### 4.1. 全体計画と仕様

*   **[開発ロードマップ (FUTURE_DEVELOPMENT.md)](FUTURE_DEVELOPMENT.md)**
    *   プロジェクト全体のフェーズ分けと、将来的なタスクを記述しています。

*   **[C++コードベース仕様書 (Specification.md)](Specification.md)**
    *   ベースとなっているOpenWAM(C++)の各コンポーネントのソースコードを解析し、その仕様をまとめたものです。

*   **[ドキュメント更新仕様書 (DOCUMENT_UPDATE_POLICY.md)](DOCUMENT_UPDATE_POLICY.md)**
    *   開発作業に伴い、各ドキュメントをどのように更新していくかのルールを定めています。

### 4.2. Pythonプロトタイプ関連

*   **[Pythonモデル設計思想 (PYTHON_MODEL_DESIGN.md)](PYTHON_MODEL_DESIGN.md)**
    *   OpenWAMのアーキテクチャをPythonで再設計する際の基本方針を記述しています。

*   **[VANOS実装ガイド (BMW_E46_M3_VANOS_Implementation_Guide.md)](BMW_E46_M3_VANOS_Implementation_Guide.md)**
    *   現在フォーカスしているVANOS機能の実装、デバッグ、テストに関する詳細なガイドです。

*   **VANOS関連 詳細仕様書**
    *   **[データソース仕様 (BMW_E46_M3_VANOS_Data_Source_Clarification.md)](BMW_E46_M3_VANOS_Data_Source_Clarification.md)**: VANOSマップのデータ定義について。
    *   **[オーバーラップ計算仕様 (BMW_E46_M3_VANOS_Overlap_Calculation_Specification.md)](BMW_E46_M3_VANOS_Overlap_Calculation_Specification.md)**: バルブオーバーラップの計算ロジックについて。
    *   **[体積効率計算仕様 (BMW_E46_M3_VANOS_Volumetric_Efficiency_Specification.md)](BMW_E46_M3_VANOS_Volumetric_Efficiency_Specification.md)**: 体積効率の計算ロジックについて。
