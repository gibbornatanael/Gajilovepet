/* =========================================================================
   ayat.js — kumpulan ayat Alkitab (Injil, hikmat, kasih, iman, keselamatan)
   Satu ayat tampil per hari di bagian atas halaman karyawan (lapor.html),
   berganti otomatis setiap hari berdasarkan tanggal — sama untuk semua
   yang membuka pada hari yang sama, tanpa perlu server.
   ========================================================================= */
const AYAT_HARIAN = [
  { ref: 'Yohanes 3:16', teks: 'Karena begitu besar kasih Allah akan dunia ini, sehingga Ia telah mengaruniakan Anak-Nya yang tunggal, supaya setiap orang yang percaya kepada-Nya tidak binasa, melainkan beroleh hidup yang kekal.' },
  { ref: 'Roma 10:9', teks: 'Sebab jika kamu mengaku dengan mulutmu, bahwa Yesus adalah Tuhan, dan percaya dalam hatimu, bahwa Allah telah membangkitkan Dia dari antara orang mati, maka kamu akan diselamatkan.' },
  { ref: 'Efesus 2:8', teks: 'Sebab karena kasih karunia kamu diselamatkan oleh iman; itu bukan hasil usahamu, tetapi pemberian Allah.' },
  { ref: 'Amsal 3:5-6', teks: 'Percayalah kepada TUHAN dengan segenap hatimu, dan janganlah bersandar kepada pengertianmu sendiri. Akuilah Dia dalam segala lakumu, maka Ia akan meluruskan jalanmu.' },
  { ref: '1 Korintus 13:4-5', teks: 'Kasih itu sabar; kasih itu murah hati; ia tidak cemburu. Ia tidak memegahkan diri dan tidak sombong. Ia tidak melakukan yang tidak sopan dan tidak mencari keuntungan diri sendiri.' },
  { ref: 'Yakobus 1:5', teks: 'Tetapi apabila di antara kamu ada yang kekurangan hikmat, hendaklah ia memintakannya kepada Allah, — yang memberi dengan murah hati kepada semua orang, — maka hal itu akan diberikan kepadanya.' },
  { ref: 'Amsal 9:10', teks: 'Permulaan hikmat adalah takut akan TUHAN, dan mengenal Yang Mahakudus adalah pengertian.' },
  { ref: 'Filipi 4:13', teks: 'Segala perkara dapat kutanggung di dalam Dia yang memberi kekuatan kepadaku.' },
  { ref: 'Ibrani 11:1', teks: 'Iman adalah dasar dari segala sesuatu yang kita harapkan dan bukti dari segala sesuatu yang tidak kita lihat.' },
  { ref: 'Roma 8:28', teks: 'Kita tahu sekarang, bahwa Allah turut bekerja dalam segala sesuatu untuk mendatangkan kebaikan bagi mereka yang mengasihi Dia.' },
  { ref: 'Yohanes 14:6', teks: 'Kata Yesus kepadanya: "Akulah jalan dan kebenaran dan hidup. Tidak ada seorang pun yang datang kepada Bapa, kalau tidak melalui Aku."' },
  { ref: 'Efesus 2:10', teks: 'Karena kita ini buatan Allah, diciptakan dalam Kristus Yesus untuk melakukan pekerjaan baik, yang dipersiapkan Allah sebelumnya bagi kita, supaya kita hidup di dalamnya.' },
  { ref: 'Mazmur 23:1', teks: 'TUHAN adalah gembalaku, takkan kekurangan aku.' },
  { ref: 'Mazmur 37:5', teks: 'Serahkanlah hidupmu kepada TUHAN dan percayalah kepada-Nya, dan Ia akan bertindak.' },
  { ref: 'Yesaya 41:10', teks: 'Janganlah takut, sebab Aku menyertai engkau, janganlah bimbang, sebab Aku ini Allahmu; Aku akan meneguhkan, bahkan akan menolong engkau.' },
  { ref: 'Matius 6:33', teks: 'Tetapi carilah dahulu Kerajaan Allah dan kebenarannya, maka semuanya itu akan ditambahkan kepadamu.' },
  { ref: 'Matius 11:28', teks: 'Marilah kepada-Ku, semua yang letih lesu dan berbeban berat, Aku akan memberi kelegaan kepadamu.' },
  { ref: 'Yohanes 13:34', teks: 'Aku memberikan perintah baru kepada kamu, yaitu supaya kamu saling mengasihi; sama seperti Aku telah mengasihi kamu demikian pula kamu harus saling mengasihi.' },
  { ref: '1 Yohanes 4:19', teks: 'Kita mengasihi, karena Allah lebih dahulu mengasihi kita.' },
  { ref: 'Galatia 5:22-23', teks: 'Tetapi buah Roh ialah: kasih, sukacita, damai sejahtera, kesabaran, kemurahan, kebaikan, kesetiaan, kelemahlembutan, penguasaan diri.' },
  { ref: 'Amsal 16:3', teks: 'Serahkanlah perbuatanmu kepada TUHAN, maka terlaksanalah segala rencanamu.' },
  { ref: 'Amsal 22:29', teks: 'Pernahkah engkau melihat orang yang cakap dalam pekerjaannya? Ia akan berdiri di hadapan raja-raja, bukan berdiri di hadapan orang-orang yang hina.' },
  { ref: 'Kolose 3:23', teks: 'Apa pun juga yang kamu perbuat, perbuatlah dengan segenap hatimu seperti untuk Tuhan dan bukan untuk manusia.' },
  { ref: 'Roma 5:8', teks: 'Akan tetapi Allah menunjukkan kasih-Nya kepada kita, oleh karena Kristus telah mati untuk kita, ketika kita masih berdosa.' },
  { ref: 'Yohanes 1:12', teks: 'Tetapi semua orang yang menerima-Nya diberi-Nya kuasa supaya menjadi anak-anak Allah, yaitu mereka yang percaya dalam nama-Nya.' },
  { ref: 'Titus 3:5', teks: 'Pada waktu itu Ia telah menyelamatkan kita, bukan karena perbuatan baik yang telah kita lakukan, tetapi karena rahmat-Nya.' },
  { ref: 'Kisah Para Rasul 4:12', teks: 'Dan keselamatan tidak ada di dalam siapa pun juga selain di dalam Dia, sebab di bawah kolong langit ini tidak ada nama lain yang diberikan kepada manusia yang olehnya kita dapat diselamatkan.' },
  { ref: 'Amsal 4:7', teks: 'Permulaan hikmat ialah: perolehlah hikmat dan dengan segala yang kau peroleh perolehlah pengertian.' },
  { ref: 'Amsal 1:7', teks: 'Takut akan TUHAN adalah permulaan pengetahuan, tetapi orang bodoh menghina hikmat dan didikan.' },
  { ref: 'Yakobus 3:17', teks: 'Tetapi hikmat yang dari atas adalah pertama-tama murni, selanjutnya pendamai, peramah, penurut, penuh belas kasihan dan buah-buah yang baik.' },
  { ref: '1 Korintus 13:13', teks: 'Demikianlah tinggal ketiga hal ini, yaitu iman, pengharapan dan kasih, dan yang paling besar di antaranya ialah kasih.' },
  { ref: 'Roma 12:2', teks: 'Janganlah kamu menjadi serupa dengan dunia ini, tetapi berubahlah oleh pembaharuan budimu.' },
  { ref: 'Roma 12:10', teks: 'Hendaklah kamu saling mengasihi sebagai saudara dan saling mendahului dalam memberi hormat.' },
  { ref: 'Efesus 4:32', teks: 'Tetapi hendaklah kamu ramah seorang terhadap yang lain, penuh kasih mesra dan saling mengampuni, sebagaimana Allah di dalam Kristus telah mengampuni kamu.' },
  { ref: 'Amsal 15:1', teks: 'Jawaban yang lemah lembut meredakan kegeraman, tetapi perkataan yang pedas membangkitkan marah.' },
  { ref: 'Amsal 17:22', teks: 'Hati yang gembira adalah obat yang manjur, tetapi semangat yang patah mengeringkan tulang.' },
  { ref: 'Amsal 31:25', teks: 'Pakaiannya adalah kekuatan dan kemuliaan, ia tertawa tentang hari depan.' },
  { ref: 'Mazmur 46:2', teks: 'Allah itu bagi kita tempat perlindungan dan kekuatan, sebagai penolong dalam kesesakan sangat terbukti.' },
  { ref: 'Mazmur 100:5', teks: 'Sebab TUHAN itu baik, kasih setia-Nya untuk selama-lamanya, dan kesetiaan-Nya tetap turun-temurun.' },
  { ref: 'Mazmur 118:24', teks: 'Inilah hari yang dijadikan TUHAN, marilah kita bersorak-sorak dan bersukacita karenanya.' },
  { ref: 'Yesaya 40:31', teks: 'Tetapi orang-orang yang menanti-nantikan TUHAN mendapat kekuatan baru: mereka seumpama rajawali yang naik terbang dengan kekuatan sayapnya.' },
  { ref: 'Yeremia 29:11', teks: 'Sebab Aku ini mengetahui rancangan-rancangan apa yang ada pada-Ku mengenai kamu, demikianlah firman TUHAN, yaitu rancangan damai sejahtera dan bukan rancangan kecelakaan, untuk memberikan kepadamu hari depan yang penuh harapan.' },
  { ref: 'Filipi 4:6-7', teks: 'Janganlah hendaknya kamu kuatir tentang apa pun juga, tetapi nyatakanlah dalam segala hal keinginanmu kepada Allah dalam doa dan permohonan dengan ucapan syukur.' },
  { ref: 'Filipi 4:19', teks: 'Allahku akan memenuhi segala keperluanmu menurut kekayaan dan kemuliaan-Nya dalam Kristus Yesus.' },
  { ref: 'Mazmur 34:9', teks: 'Kecaplah dan lihatlah, betapa baiknya TUHAN itu! Berbahagialah orang yang berlindung pada-Nya!' },
  { ref: '2 Korintus 5:17', teks: 'Jadi siapa yang ada di dalam Kristus, ia adalah ciptaan baru: yang lama sudah berlalu, sesungguhnya yang baru sudah datang.' },
  { ref: 'Galatia 2:20', teks: 'Namun aku hidup, tetapi bukan lagi aku sendiri yang hidup, melainkan Kristus yang hidup di dalam aku.' },
  { ref: 'Yohanes 15:5', teks: 'Akulah pokok anggur dan kamulah ranting-rantingnya. Barangsiapa tinggal di dalam Aku dan Aku di dalam dia, ia berbuah banyak.' },
  { ref: 'Yohanes 15:13', teks: 'Tidak ada kasih yang lebih besar dari pada kasih seorang yang memberikan nyawanya untuk sahabat-sahabatnya.' },
  { ref: '1 Petrus 5:7', teks: 'Serahkanlah segala kekuatiranmu kepada-Nya, sebab Ia yang memelihara kamu.' },
  { ref: 'Amsal 18:10', teks: 'Nama TUHAN adalah menara yang kuat, ke sanalah orang benar berlari dan ia menjadi selamat.' },
  { ref: 'Amsal 27:17', teks: 'Besi menajamkan besi, orang menajamkan sesamanya.' },
  { ref: 'Yosua 1:9', teks: 'Kuatkan dan teguhkanlah hatimu, janganlah kecut dan tawar hati, sebab TUHAN, Allahmu, menyertai engkau, ke mana pun engkau pergi.' },
  { ref: 'Ulangan 31:6', teks: 'Kuatkan dan teguhkanlah hatimu, janganlah takut dan janganlah gentar; sebab TUHAN, Allahmu, sendirilah yang berjalan menyertai engkau; Ia tidak akan membiarkan engkau dan tidak akan meninggalkan engkau.' },
  { ref: '2 Timotius 1:7', teks: 'Sebab Allah memberikan kepada kita bukan roh ketakutan, melainkan roh yang membangkitkan kekuatan, kasih dan ketertiban.' },
  { ref: 'Ibrani 11:6', teks: 'Tetapi tanpa iman tidak mungkin orang berkenan kepada Allah. Sebab barangsiapa berpaling kepada Allah, ia harus percaya bahwa Allah ada.' },
  { ref: 'Ibrani 13:5', teks: '"Aku sekali-kali tidak akan membiarkan engkau dan Aku sekali-kali tidak akan meninggalkan engkau."' },
  { ref: 'Ratapan 3:22-23', teks: 'Tak berkesudahan kasih setia TUHAN, tak habis-habisnya rahmat-Nya, selalu baru tiap pagi; besar kesetiaan-Mu!' },
  { ref: 'Amsal 11:25', teks: 'Siapa banyak memberi berkat, diberi kelimpahan, siapa memberi minum, akan diberi minum juga.' },
  { ref: 'Amsal 12:25', teks: 'Kekuatiran dalam hati membungkukkan orang, tetapi perkataan yang baik menggembirakan dia.' },
  { ref: 'Kolose 3:12', teks: 'Karena itu, sebagai orang-orang pilihan Allah yang dikuduskan dan dikasihi-Nya, kenakanlah belas kasihan, kemurahan, kerendahan hati, kelemahlembutan dan kesabaran.' },
  { ref: 'Kolose 3:17', teks: 'Dan segala sesuatu yang kamu lakukan dengan perkataan atau perbuatan, lakukanlah semuanya itu dalam nama Tuhan Yesus, sambil mengucap syukur oleh Dia kepada Allah, Bapa kita.' },
  { ref: 'Roma 15:13', teks: 'Semoga Allah, sumber pengharapan, memenuhi kamu dengan segala sukacita dan damai sejahtera dalam iman kamu.' },
  { ref: 'Mikha 6:8', teks: 'Berlaku adil, mencintai kesetiaan, dan hidup dengan rendah hati di hadapan Allahmu.' },
  { ref: 'Amsal 10:12', teks: 'Kebencian menimbulkan pertengkaran, tetapi kasih menutupi segala pelanggaran.' },
  { ref: '1 Yohanes 4:7', teks: 'Saudara-saudaraku yang kekasih, marilah kita saling mengasihi, sebab kasih itu berasal dari Allah.' },
  { ref: 'Wahyu 21:4', teks: 'Ia akan menghapus segala air mata dari mata mereka, dan maut tidak akan ada lagi; tidak akan ada lagi perkabungan, atau ratap tangis, atau dukacita.' },
  { ref: 'Efesus 6:10', teks: 'Akhirnya, hendaklah kamu kuat di dalam Tuhan, di dalam kekuatan kuasa-Nya.' },
];

/* Ayat hari ini — deterministik berdasarkan tanggal, sama untuk semua
   yang membuka aplikasi di hari yang sama, otomatis berganti besok. */
function ayatHariIni() {
  const d = new Date();
  const awalTahun = new Date(d.getFullYear(), 0, 0);
  const hariKe = Math.floor((d - awalTahun) / 86400000);
  return AYAT_HARIAN[hariKe % AYAT_HARIAN.length];
}
window.ayatHariIni = ayatHariIni;
