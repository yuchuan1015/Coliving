# 寵物可信資產登錄

`assets.json` 是後端發布包內的唯讀登錄。初始為空：目前兩批圖片尚未完成交付／正式資產接線，不能視為可發布圖庫。

格式為 `schema_version: 1`、非空 `catalog_version`、`assets` 陣列。每個項目具有唯一 `asset_key`、`species`、`emoji`、同站 `image_url` 與布林 `published`；只有明確 `true` 的項目可領養／確認到家。`image_url` 限 `/assets/pets/` 下 png、webp、avif，不能是外部 URL、本機路徑、查詢字串或跳出目錄的路徑。

圖片任務交付後，由工程確認同一資產 key 對應已驗收的圖檔、與前端正式資產路徑一致，再在經授權的發布包中登錄。不要由居民或管理 HTTP 請求寫入此登錄；管理準備 API 只能引用已發布 key。更換外觀／版本應使用新 key，避免同一引用悄悄換圖。

沒有可用圖資時，catalog 回空清單；普通領養不可繞過，但符合名額資格的居民可提出許願。許願可以先處於 pending/preparing，等真實圖資發布後再人工確認到家。舊寵物保留 nullable asset_key 與既有 emoji，不做猜測式回填。

測試透過隔離 fixture 提供合成圖庫；不得將測試登錄或佔位圖搬入正式 `assets.json`。
