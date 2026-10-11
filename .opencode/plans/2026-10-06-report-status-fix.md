# إصلاح تذبذب «جلب التقرير» + تحديث شريحة المتصل/غير المتصل

الحالة: بانتظار انتهاء وضع التخطيط للتنفيذ. المستخدم وافق: «نعم، نفّذ الكل (موصى به)» + طباعات تشخيص مؤقتة خلف `kDebugMode`.

## التشخيص (مُتحقق بالقراءة والاختبار المباشر)

- اختبار WebSocket مباشر ضد الخادم `172.20.20.92:3111`: حدث `check_ai_status` أعاد `ok:true` + بيانات خلال **2.0 ث** بلا مصادقة ← **الخادم سليم**، الخلل في توقيت/حالة العميل.
- JWT `expiresIn: "1d"` (`src/utils/jwt.ts:13`)؛ صحّة التطبيق تعتمد على `tryRefreshToken` (إعادة login) عبر `_healthCheck` كل 30 ث.
- نوافذ الانقطاع (تظهر وتختفي):
  1. توكن منتهٍ + محاولة re-handshake → الخادم `socket.disconnect(true)` (`device.socket.ts:297-300`) → ميت حتى نجاح refresh التالي (≤40 ث أو أطول لو فشل refresh).
  2. `socket_service.dart:244-247` timeout ‏10 ث → `null` → «فشل الاتصال بالخادم».
  3. `dashboard_controller.dart:205-210`: عند فشل refresh قد يُنادى `reconnect(token: null)` → الخادم يعدّ الاتصال **متصلًا دون مصادق** → `mobile:subscribe` يُتجاهل بصمت (`device.socket.ts:342-344`) → **لا دفعات إطلاقاً والشريط أخضر** — يطابق «تعمل أحياناً وتتجمد أحياناً».
- خلل الشريحة (مؤكد):
  - `dashboard_controller.dart:149-151`: `info.internet` يُحدَّث فقط لو `source == ping` → تلمتري `device_telemetry_update` (يحمل `internet`) يُرمى.
  - `_fetchLatestTelemetry` (`dashboard_controller.dart:221-245`): السيرفر يعيد `internet` في snapshot ✓ لكن الكود يتجاهله (battery/temperature/uptime فقط).

## التعديلات (flutter_app فقط — مشروع الويب قراءة)

### 1. `lib/services/socket_service.dart`
- `emitCheckAiStatus` + `requestLatestTelemetry`: مهلة `timeout` ‏10 → **30 ث**.
- حفظ `_lastToken` في `connect()`؛ في `reconnect(token: null)` → استبداله بـ`_lastToken`؛ وبقائه `null` → **عدم إجراء أي اتصال** (return) بدل إرسال توكن فارغ.
- فحص مصادقة بعد الاتصال: في `onConnect` بعد `mobile:subscribe` أرسل `requestLatestTelemetry()`؛ لو الرد `error == not authenticated` → إشارة عبر callback جديد `onAuthMismatch` (يضبطه الـ controller) → refresh + reconnect فوري (مع `bool _authProbeInFlight` وحارس ألّا يعيد الإرسال إلا إذا تغيّر التوكن — لتفادي حلقة).
- طباعات `kDebugMode` قصيرة: سبب `null` (not-connected / timeout / non-map) + زمن وصول الـ ack.

### 2. `lib/controllers/dashboard_controller.dart`
- السطر 149-151: تحديث `info.internet` من **كل** المصادر عندما تكون القيمة non-null (تعديل `DeviceStatusEntry.internet` → `String?` ومراعاته في المشترين `devices_status`/`device_telemetry_update`/`device_ping_update` بحسب: لو null لا نغيّر الحالة الحالية).
- `_fetchLatestTelemetry`: تمرير `internet` من snapshot: `if (data['internet'] != null) info.internet = ...`.
- `_attemptSocketRecovery`: إن فشل refresh و`token == null` → **عدم** استدعاء `reconnect` (طباعة + انتظار health check التالي) — حارس مزدوج فوق إصلاح socket_service.
- إضافة `Future<bool> ensureConnected()` عامة (تعيد false إن بقيت غير متصلة بعد محاولة) تستدعى من حوار التقرير.

### 3. `lib/screens/dashboard_screen.dart`
- `_fetch()`:
  - قبل الإرسال: لو غير متصل → `ensureConnected()` + انتظار حتى connected (حد أقصى ~5 ث) → إن تصل أعد الإرسال مرة واحدة؛ وإلا رسالة **«انقطع الاتصال بالخادم — تحقق من الشبكة»**.
  - timeout → رسالة **«استغرق الخادم وقتاً طويلاً — أعد المحاولة»** (بديل نص «فشل الاتصال بالخادم»).
  - إعادة محاولة تلقائية واحدة فقط (عدّاد داخل `_fetch`).

## التحقق بعد التنفيذ
1. `flutter analyze` → **74** (خط الأساس، لا زيادة).
2. `flutter test test/buildrgba_golden_test.dart test/warp_display_test.dart` → 11/11 + pass (لا تشغيل `spectro_test.dart` المعطوب).
3. `flutter build apk --profile` → تثبيت على Waydroid (`waydroid app install`) + الهاتف (`adb -s H9YNW20A29001562 install -r`).
4. اختبار فعلي: التقرير ×5 (نطاق 24 ساعة وساعة) نجاح دائم؛ قطع/وصل الشبكة → الشريط يتبع؛ الشريحة تتغير ≤60 ث بعد كل باكت.
5. الطبعات تبقى خلف `kDebugMode` (الإصدار release لا يطبع).

## خارج النطع / مخاطر
- إن بقيت الشريحة متجمدة بعد الإصلاح → الطرف الآخر (pi) لا يرسل `devices_status`/`ping` إلى `.92` → فحص كونسول الخادم البعيد (سطر `🚨 devices_status event received`) — خارج هذا الريبو ولا يُلمس.
- أي تعديل إضافي على `spectro.dart` يحتاج إذناً جديداً (غير مطلوب هنا).
- مؤجل للإصدار (غير مرتبط): حذف طباعات `[TIMING]`/`[DbgRx]`.
