---
layout: archive
title: "Research"
permalink: /research/
author_profile: true
---

## Stellar Formation

<div style="text-align:center;">
  <!-- Image Slider for Stellar Formation Research -->
  <div id="stellar-slider" style="position: relative; width: 100%; max-width: 600px; margin: auto;">
    <img src="https://seratsaad.github.io/images/pms1.jpg" alt="Stellar Research 1" style="height:100%; object-fit: contain;" class="stellar-image">
    <img src="https://seratsaad.github.io/images/pms2.jpg" alt="Stellar Research 2" style="height:100%; object-fit: contain;" class="stellar-image" style="display:none;">
    <img src="https://seratsaad.github.io/images/Halpha_eqw.jpg" alt="Stellar Research 4" style="height:100%; object-fit: contain;" class="stellar-image" style="display:none;">
  </div>
</div>

<!-- Works -->
- Papers:
- Presentations:

---

## Supermassive Black Hole Binaries

<div style="text-align:center;">
  <!-- Image Slider for Supermassive Black Hole Binaries -->
  <div id="blackhole-slider" style="position: relative; width: 100%; max-width: 600px; margin: auto;">
    <img src="https://seratsaad.github.io/images/comparison_spectra.jpg" alt="Black Hole Research 1" style="width:100%" class="blackhole-image">
    <img src="https://seratsaad.github.io/images/hbeta_fullfit.jpg" alt="Black Hole Research 2" style="width:100%" class="blackhole-image" style="display:none;">
    <img src="https://seratsaad.github.io/images/halpha_fullfit-2.jpg" alt="Black Hole Research 3" style="width:100%" class="blackhole-image" style="display:none;">
  </div>
</div>

<!-- Works -->
- Papers:
- Presentations:


---

<!-- JavaScript for Image Slider -->
<script>
  let stellarIndex = 0;
  let blackholeIndex = 0;
  function cycleImages(className, indexVar) {
    let images = document.getElementsByClassName(className);
    for (let i = 0; i < images.length; i++) {
      images[i].style.display = "none";
    }
    indexVar++;
    if (indexVar > images.length) { indexVar = 1 }
    images[indexVar-1].style.display = "block";
    return indexVar;
  }
  setInterval(function() {
    stellarIndex = cycleImages('stellar-image', stellarIndex);
    blackholeIndex = cycleImages('blackhole-image', blackholeIndex);
  }, 2000);  // Change image every 2 seconds
</script>
