/**
 * 注意：执行compile命令会重新生成本文件，所以请不要修改本文件
 */
import idMap from "./idMap.js"
import { translate,VoerkaI18nScope  } from "@voerkai18n/runtime"
import defaultFormatters from "./formatters/zh.js"
import defaultMessages from "./zh.js"
import storage  from "./storage.js"

const messages = {
    'zh' :  defaultMessages,
    'en' : ()=>import("./en.js"),
	'jp' : ()=>import("./jp.js"),
	'ar' : ()=>import("./ar.js")
}

const formatters = {
    'zh' :  defaultFormatters,
    'en' : ()=>import("./formatters/en.js"),
	'jp' : ()=>import("./formatters/jp.js"),
	'ar' : ()=>import("./formatters/ar.js")
}

const scopeSettings = {
    "languages": [
        {
            "name": "zh",
            "title": "中文",
            "default": true,
            "active": true
        },
        {
            "name": "en",
            "title": "英语"
        },
        {
            "name": "jp",
            "title": "日语"
        },
        {
            "name": "ar",
            "title": "阿拉伯语"
        }
    ],
    "namespaces": {}
}

const scope = new VoerkaI18nScope({
    id          : "{{packageName}}",
    debug       : false,
    idMap,
    library     : false,
    messages,
    formatters,
    storage,
    ...scopeSettings
})

const scopedTtranslate = translate.bind(scope)
export {
    scopedTtranslate as t,
    scope as i18nScope
}
