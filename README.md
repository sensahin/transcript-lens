# Transcript Lens

YouTube transkriptini yalnızca okumak yerine **anlamına göre keşfedin**. Jev, metni yeniden yazmadan parçaları sınıflandırır; bölümleri, önemli pasajları ve aradığınız konunun geçtiği yerleri bulmaya yardımcı olur.

Türkçe arayüzlü, Next.js tabanlı deneysel bir uygulamadır. Kendi bilgisayarınızda çalıştırabilir veya kendi Vercel hesabınıza dağıtabilirsiniz.

## Neler yapar?

- YouTube bağlantısından altyazı almaya çalışır; SRT, VTT ve zaman damgalı metin yapıştırmayı destekler.
- Tam metin, temiz metin ve yalnızca önemli kısımlar görünümleri sunar.
- Konu değişimlerinden bölüm sınırları çıkarır; başlıkları metindeki ifadelerden seçer.
- Şaşırtıcı, komik, uygulanabilir ve benzeri ölçütleri ısı haritasında gösterir.
- İddia, görüş, öngörü, anı ve soruları sınıflandırır. **İddiaların doğruluğunu kontrol etmez.**
- Yazdığınız konuya göre ilgili pasajları bulur; özet yerine özgün sözleri gösterir.
- Görünümü TXT, Markdown, SRT, VTT veya JSON olarak indirir.

## Hızlı başlangıç

**Gerekenler:** Node.js 22 veya üzeri, npm. Jev analizi için kendi Vercel AI Gateway ya da TypeSafe API erişiminiz gerekir.

```bash
git clone https://github.com/sensahin/transcript-lens.git
cd transcript-lens
npm ci
cp .env.example .env.local
npm run dev
```

Windows PowerShell kullanıyorsanız kopyalama komutu `Copy-Item .env.example .env.local` olur.

[http://localhost:3000](http://localhost:3000) adresini açın. Ana sayfadaki **Türkçe örnek transkript** düğmesine, ardından **Bu transkripti kullan** düğmesine basın. Bu örnek proje için yazılmıştır; başka bir videodan alınmamıştır.

**Anahtarsız da deneyebilirsiniz:** örnek/yapıştırılan metin açılır ve dışa aktarılabilir. Analiz anahtarı yoksa açıklayıcı bir mesaj gösterilir; ısı haritası, bölümler ve anlamsal arama için Jev gerekir. Anahtar tanımlıysa transkript yüklenince analiz otomatik başlar ve sağlayıcı kullanımı ücret doğurabilir.

Git kullanmıyorsanız GitHub'da **Code → Download ZIP** seçeneğini veya [sürüm paketini](https://github.com/sensahin/transcript-lens/releases/latest) indirin; klasörü açtıktan sonra `npm ci` ile devam edin.

## Analiz sağlayıcısını yapılandırma

### Seçenek A: Vercel AI Gateway

Vercel hesabınızda AI Gateway erişimini ve Jev modelinin kullanılabilirliğini kontrol edin. Bir Gateway anahtarı oluşturup `.env.local` dosyasına yazın:

```dotenv
JEV_PROVIDER=gateway
AI_GATEWAY_API_KEY=buraya_kendi_anahtarinizi_yazin
```

Uygulama AI SDK'nin `experimental_evaluate` işleviyle `typesafe-ai/jev` modelini çağırır. Bu bir sohbet/metin üretim modeli çağrısı değildir. Rastgele bir model adıyla değiştirmek çalışmayabilir.

### Seçenek B: Doğrudan TypeSafe

TypeSafe hesabınızın Jev API erişimi varsa:

```dotenv
JEV_PROVIDER=typesafe
TYPESAFE_API_KEY=buraya_kendi_anahtarinizi_yazin
```

Kullanmadığınız sağlayıcının anahtarını boş bırakın. İki anahtar da tanımlıysa Gateway hatasında doğrudan TypeSafe'e geri dönüş yapılabilir; iki ayrı sağlayıcıda kullanım oluşabilir. Ortam değişkenlerini değiştirdikten sonra geliştirme sunucusunu yeniden başlatın.

Anahtarları `NEXT_PUBLIC_` ile başlayan değişkenlere, kaynak koda, ekran görüntüsüne veya GitHub issue'suna koymayın. `.env.local` Git tarafından dışlanır; `.env.example` yalnızca boş alanlar içerir.

## Vercel'e dağıtım

1. Bu depoyu GitHub hesabınıza **Fork** edin.
2. [Vercel New Project](https://vercel.com/new) ekranından kendi fork'unuzu içe aktarın.
3. **Framework Preset:** Next.js. **Root Directory:** depo kökü (`.`). **Node.js:** 22.x veya desteklenen daha yeni bir sürüm.
4. Kurulum komutu `npm ci`, derleme komutu `npm run build` olsun. Output Directory alanını Next.js varsayılanında bırakın.
5. **Environment Variables** alanında seçtiğiniz sağlayıcıyı ayarlayın:
   - Gateway için `JEV_PROVIDER=gateway` ve kendi `AI_GATEWAY_API_KEY` değeriniz.
   - TypeSafe için `JEV_PROVIDER=typesafe` ve kendi `TYPESAFE_API_KEY` değeriniz.
   - Production için ekleyin; önizlemelerde de analiz istiyorsanız Preview ortamına ayrıca ekleyin.
6. **Deploy** düğmesine basın. Başarılı dağıtımdan sonra önce Türkçe örnek metni deneyin.
7. Anahtarları sonradan eklediyseniz **Redeploy** yapın. Uzun analizlerde seçtiğiniz Vercel planının işlev süre sınırlarını kontrol edin; analiz rotası 300, arama rotası 120 saniye talep eder.

**OIDC alternatifi:** Vercel üzerinde AI Gateway, uygun hesap/proje yapılandırmasıyla otomatik OIDC kimlik doğrulamasını destekler. Bu yolu kullanıyorsanız `JEV_PROVIDER=gateway` yeterli olabilir; kısa ömürlü `VERCEL_OIDC_TOKEN` değerini elle kopyalayıp kalıcı anahtar gibi saklamayın. Yukarıdaki açık anahtar yöntemi, yerelde ve başka barındırıcılarda da aynı kurulumu izlemek içindir.

**Dağıtım ile ücretsiz kullanım aynı şey değildir.** Bu demoda kullanıcı hesabı veya kalıcı, küresel harcama limiti yoktur. Anahtar eklediğiniz bir dağıtıma erişen ziyaretçiler sizin hesabınızdan çağrı yaptırabilir. Kişisel deneme için dağıtımınıza erişimi Vercel'in uygun koruma seçenekleriyle sınırlandırın; herkese açık hizmet sunmadan önce kimlik doğrulama, kalıcı kota ve harcama kontrolü ekleyin. Süreç içindeki IP sınırı tek başına maliyet güvencesi değildir.

Resmî kaynaklar: [Vercel Git dağıtımı](https://vercel.com/docs/git), [Gateway API anahtarları](https://vercel.com/docs/ai-gateway/authentication-and-byok/api-keys), [OIDC](https://vercel.com/docs/ai-gateway/authentication-and-byok/oidc), [yapılandırılmış değerlendirme](https://vercel.com/docs/ai-gateway/modalities/evaluation), [dağıtım koruması](https://vercel.com/docs/deployment-protection).

## YouTube erişimi hakkında

Bu prototipin bağlantıdan altyazı alma kodu **resmî YouTube Data API kullanmaz**; YouTube'un belgelenmemiş oynatıcı uç noktalarına dayanır. YouTube tarafından onaylanmış bir entegrasyon olduğu iddia edilmez. Erişim özellikle bulut sunucularından engellenebilir, değişebilir veya hiç çalışmayabilir. Bu nedenle Vercel'e başarılı dağıtım, YouTube'dan altyazı alınabileceği anlamına gelmez.

Yalnızca sahibi olduğunuz veya işlemek için gerekli izne sahip olduğunuz içerikleri kullanın; ilgili platform koşullarını ayrıca değerlendirin. MIT lisansı yazılımı kapsar, üçüncü taraf videolarını veya transkriptlerini kapsamaz. Depoda üçüncü taraf videoların hazır transkriptleri bulunmaz.

Altyazı çekilemezse **veya transkript yapıştır** seçeneğine kendi SRT/VTT metninizi ekleyin. API anahtarı yalnızca Jev içindir; bir YouTube API anahtarı eklemek bu alma yöntemini değiştirmez.

## Bilinen sınırlar

- Zaman damgasız düz metinde zamanlar yaklaşık üç sözcük/saniye varsayımıyla üretilir ve arayüzde tahmini olarak belirtilir. Bu metinlerden alınan SRT/VTT de tahminidir; gerçek video eşzamanlaması için kaynak zaman damgaları gerekir.
- Cümlelerin zamanları parça içinde yaklaşık hesaplanır. Altyazıların kendisi de hatalı olabilir.
- Türkçe arayüz, Türkçe için ölçülmüş model doğruluğu anlamına gelmez. Bölüm başlığı adaylarını çıkaran özgün algoritma İngilizce ağırlıklıdır; Türkçe başlıklar zayıf kalabilir.
- Temiz/önemli görünüm otomatik seçimdir; bağlam kaybını önlemek için tam metni kontrol edin. Model olasılıkları doğruluk garantisi değildir.
- Analiz ve arama her çalıştırıldığında yeni çağrılar yapar. Yaklaşık 64 eşzamanlı iş, yeniden denemeler ve olası sağlayıcı geçişi ek kullanım oluşturabilir. Sekmeyi kapatmak sağlayıcıya ulaşmış çağrıları geri almaz.
- Sunucu başına `ANALYSES_PER_HOUR` (20) ve `LENSES_PER_HOUR` (60) sınırları en iyi çaba korumasıdır; yeniden başlatma ve birden fazla sunucu örneğinde ortak değildir. Yerel/eksik IP bu sınıra tabi değildir.
- Bölüm zamanlarını kopyalama, YouTube'un bölüm kabul koşullarını otomatik doğrulamaz.
- Hesap, veritabanı veya kayıt geçmişi yoktur; sayfayı yenilemeden önce sonuçları indirin.

## Veri akışı

Yapıştırılan metin uygulamanın sunucusuna gider. Analiz etkinse metin parçaları ve sorular seçilen AI sağlayıcısına gönderilir. YouTube bağlantısı kullanıldığında YouTube'a istek yapılır; oynatıcı da YouTube'un gömülü oynatıcısıdır. Sunucu kodu metinleri bir veritabanına kaydetmez; bu, barındırıcı veya sağlayıcı tarafında hiçbir kayıt tutulmadığı anlamına gelmez. Hassas içeriği göndermeden önce kendi sağlayıcı ayarlarınızı inceleyin.

## Geliştirme ve kontroller

```bash
npm test
npm run typecheck
npm run build
npm start
```

Farklı port: `npm run dev -- --port 3001`. Testler gerçek API anahtarı kullanmaz; dış sağlayıcı yanıtları test içinde taklit edilir. GitHub Actions her push/PR için test, tür kontrolü ve derlemeyi çalıştırır.

```text
src/app/page.tsx           Türkçe arayüz ve sonuç görünümleri
src/app/Player.tsx         YouTube oynatıcısı
src/app/Heatmap.tsx        Isı haritası
src/app/api/               Transkript, analiz ve arama rotaları
src/lib/youtube.ts        Bağlantı çözümleme ve deneysel altyazı alma
src/lib/transcript.ts     Metni parçalara bölme ve dışa aktarma
src/lib/analyze.ts        Jev soruları, bölüm ve cümle analizi
src/lib/jev.ts            Gateway / TypeSafe istemcisi
src/lib/views.ts          Görünümlere ait seçim kuralları
src/lib/stream.ts         Akış, girdi doğrulama ve süreç içi sınırlar
tests/                   Anahtarsız otomatik kontroller
```

Sorun bildirirken tarayıcı/sunucu hatasını ve yeniden üretme adımlarını ekleyin; API anahtarı, özel transkript veya kişisel bilgi paylaşmayın.

## Lisans

[MIT](LICENSE). Projeyi indirebilir, inceleyebilir, değiştirebilir ve lisans koşullarıyla paylaşabilirsiniz.
