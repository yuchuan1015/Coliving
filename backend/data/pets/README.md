# 寵物可信資產登錄

`assets.json` 是後端發布包內的唯讀登錄。2026-09-12 已接入兩批共 28 張通過去背驗收的圖片，catalog version 為 `rookery-pets-v1-20260912`。本輪僅完成本地整合，尚未推送或部署；`published: true` 表示此發布包內可供領養／確認到家的資產資格，不表示正式站已上線。

登錄逐位元組對齊前端 `frontend/public/assets/pets/catalog.json`，SHA256 為 `1ceca794f8b6a9ae48907e82dc8dc084cf3acb5c20ea404d8cdefe7910a4e8a4`。key 為 `{id}-v1`，圖片 URL 為 `/assets/pets/v1/{id}.png`；28 張網站用圖均為 384×384 RGBA PNG，合計 4,136,329 bytes。後端已核對每張實際圖檔的 SHA、尺寸與 RGBA header，與前端 `docs/pet-assets-v1-provenance.json` 的驗收紀錄一致。完整交付見 `docs/寵物圖庫接線紀錄.md`。

格式為 `schema_version: 1`、非空 `catalog_version`、`assets` 陣列。每個項目具有唯一 `asset_key`、`species`、`emoji`、同站 `image_url` 與布林 `published`；只有明確 `true` 的項目可領養／確認到家。`image_url` 限 `/assets/pets/` 下 png、webp、avif，不能是外部 URL、本機路徑、查詢字串或跳出目錄的路徑。

後續圖片交付仍由工程確認同一資產 key 對應已驗收的圖檔、與前端正式資產路徑一致，再登錄。正式發布時需先確保前端同站圖檔可用，再啟用含此登錄的後端版本。不要由居民或管理 HTTP 請求寫入此登錄；管理準備 API 只能引用已發布 key。更換外觀／版本應使用新 key，避免同一引用悄悄換圖。

沒有可用圖資時，catalog 回空清單；普通領養不可繞過，但符合名額資格的居民可提出許願。許願可以先處於 pending/preparing，等真實圖資發布後再人工確認到家。舊寵物保留 nullable asset_key 與既有 emoji，不做猜測式回填。

測試透過隔離 fixture 提供合成圖庫；不得將測試登錄或佔位圖搬入正式 `assets.json`。
