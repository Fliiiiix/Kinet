const HAPPENINGS=[{tmdbId:550,trigger:`click`,icon:`🥊`,run:runFightClubHappening},{tmdbId:670,trigger:`click`,icon:`🔨`,run:runOldBoyHappening},{tmdbId:785084,trigger:`dwell`,dwellMs:2e4,run:runWhaleHappening},{tmdbId:1368337,trigger:`click`,icon:`🪓`,run:runOdysseyHappening},{tmdbId:598,trigger:`click`,icon:`🔫`,run:runCityOfGodHappening},{tmdbId:807,trigger:`click`,icon:`📦`,run:runSevenHappening},{tmdbId:244786,trigger:`click`,icon:`🥁`,run:runWhiplashHappening},{tmdbId:4977,trigger:`click`,icon:`🎪`,run:runPaprikaHappening},{tmdbId:954,trigger:`click`,icon:`💣`,run:runMissionImpossibleHappening},{tmdbId:155,trigger:`click`,icon:`🪙`,run:runDarkKnightHappening},{tmdbId:37165,trigger:`click`,icon:`🚪`,run:runTrumanShowHappening},{tmdbId:27205,trigger:`click`,icon:`🌀`,run:runInceptionHappening},{tmdbId:496243,trigger:`click`,icon:`🪨`,run:runParasiteHappening}];function getEffectiveHappenings(){const overrides=typeof getAdminHappeningOverrides===`function`?getAdminHappeningOverrides():{};const custom=typeof getAdminCustomHappenings===`function`?getAdminCustomHappenings():[];const builtIn=HAPPENINGS.filter(h=>!(overrides[h.tmdbId]&&overrides[h.tmdbId].enabled===false));const customEntries=custom.filter(c=>c.enabled!==false).map(c=>({tmdbId:c.tmdbId,trigger:c.trigger,dwellMs:c.dwellMs,icon:c.icon||`✨`,run:film=>runCustomHappening(c,film)}));return[...builtIn,...customEntries]}function getHappeningForFilm(film){return film&&film.tmdbId?getEffectiveHappenings().find(h=>h.tmdbId===film.tmdbId)||null:null}function runCustomHappening(entry){const overlay=document.createElement(`div`);overlay.className=`overlay open`;overlay.innerHTML=`
    <div class="modal happening-modal">
      <div class="modal-head">
        <h2>${escapeHtml(entry.icon||`✨`)} ${escapeHtml(entry.title||`Un petit quelque chose`)}</h2>
        <button class="close-x" data-close aria-label="Fermer">✕</button>
      </div>
      <p class="happening-caption">${escapeHtml(entry.message||``)}</p>
    </div>
  `;document.body.appendChild(overlay);overlay.addEventListener(`click`,e=>{if(e.target===overlay||e.target.closest(`[data-close]`))overlay.remove()})}function getClickHappeningForFilm(film){const h=getHappeningForFilm(film);return h&&h.trigger===`click`?h:null}function prefersReducedMotion(){return window.matchMedia(`(prefers-reduced-motion: reduce)`).matches}function runFightClubHappening(){if(prefersReducedMotion()){showToast(`« La première règle du Fight Club... »`);return}const el=document.createElement(`div`);el.className=`happening-flash`;el.innerHTML=`<span>TU NE DEVRAIS PAS ÊTRE LÀ</span>`;document.body.appendChild(el);requestAnimationFrame(()=>el.classList.add(`show`));setTimeout(()=>el.remove(),260)}function runOldBoyHappening(){const overlay=document.createElement(`div`);overlay.className=`overlay open`;overlay.innerHTML=`
    <div class="modal happening-modal">
      <div class="modal-head">
        <h2>Un seul plan.</h2>
        <button class="close-x" data-close aria-label="Fermer">✕</button>
      </div>
      <div class="oldboy-corridor">
        <div class="oldboy-corridor-track${prefersReducedMotion()?` static`:``}">
          <span>🚪</span><span>🔨</span><span>🚪</span><span>🔨</span><span>🚪</span><span>🔨</span><span>🚪</span>
        </div>
      </div>
      <p class="happening-caption">Un couloir. Un marteau. Une seule prise, du début à la fin.</p>
    </div>
  `;document.body.appendChild(overlay);overlay.addEventListener(`click`,e=>{if(e.target===overlay||e.target.closest(`[data-close]`))overlay.remove()})}let whaleDwellTimer=null;function startDwellWatch(film){clearDwellWatch();const h=getHappeningForFilm(film);if(!h||h.trigger!==`dwell`)return;whaleDwellTimer=setTimeout(h.run,h.dwellMs)}function clearDwellWatch(){if(whaleDwellTimer){clearTimeout(whaleDwellTimer);whaleDwellTimer=null}}function runWhaleHappening(){if(!document.getElementById(`overlay`).classList.contains(`open`))return;showToast(`« NON ! Pas l'ordinateur ! »`);if(prefersReducedMotion())return;const el=document.createElement(`div`);el.className=`happening-fly`;el.textContent=`💻`;document.body.appendChild(el);requestAnimationFrame(()=>el.classList.add(`fly`));setTimeout(()=>el.remove(),1300)}const ODYSSEY_GAIN=5;const ODYSSEY_DECAY=2.8;const ODYSSEY_TICK_MS=100;const ODYSSEY_BOW_TOP={x:110,y:20};const ODYSSEY_BOW_BOTTOM={x:110,y:180};const ODYSSEY_STRING_LOOSE={x:168,y:148};const ODYSSEY_BOW_MID_X_REST=68;const ODYSSEY_BOW_MID_X_FULL=18;const ODYSSEY_STRING_SAG_MAX=26;function updateOdysseyBow(tensionPct){const t=tensionPct/100;const bowMidX=ODYSSEY_BOW_MID_X_REST+(ODYSSEY_BOW_MID_X_FULL-ODYSSEY_BOW_MID_X_REST)*t;const endX=ODYSSEY_STRING_LOOSE.x+(ODYSSEY_BOW_TOP.x-ODYSSEY_STRING_LOOSE.x)*t;const endY=ODYSSEY_STRING_LOOSE.y+(ODYSSEY_BOW_TOP.y-ODYSSEY_STRING_LOOSE.y)*t;const bowPath=document.getElementById(`odysseyBowPath`);const stringPath=document.getElementById(`odysseyStringPath`);const stringEnd=document.getElementById(`odysseyStringEnd`);if(!bowPath)return;bowPath.setAttribute(`d`,`M${ODYSSEY_BOW_TOP.x},${ODYSSEY_BOW_TOP.y} Q${bowMidX},100 ${ODYSSEY_BOW_BOTTOM.x},${ODYSSEY_BOW_BOTTOM.y}`);const sag=ODYSSEY_STRING_SAG_MAX*(1-t);const midX=(ODYSSEY_BOW_BOTTOM.x+endX)/2+sag;const midY=(ODYSSEY_BOW_BOTTOM.y+endY)/2;stringPath.setAttribute(`d`,`M${ODYSSEY_BOW_BOTTOM.x},${ODYSSEY_BOW_BOTTOM.y} Q${midX},${midY} ${endX},${endY}`);stringEnd.setAttribute(`cx`,endX);stringEnd.setAttribute(`cy`,endY);stringEnd.setAttribute(`r`,t>=1?5.5:4)}function runOdysseyHappening(){const overlay=document.createElement(`div`);overlay.className=`overlay open`;overlay.innerHTML=`
    <div class="modal happening-modal">
      <div class="modal-head">
        <h2>L'épreuve de l'arc</h2>
        <button class="close-x" data-close aria-label="Fermer">✕</button>
      </div>
      <p class="happening-caption" id="odysseyCaption">Douze anneaux de hache, un seul arc à bander : plie-le et accroche la corde à l'encoche du sommet, vite et sans t'arrêter, ou elle retombe.</p>
      <svg class="odyssey-bow" viewBox="0 0 220 200" aria-hidden="true">
        <line x1="15" y1="100" x2="205" y2="100" class="odyssey-bow-guide"/>
        <!-- Encoche du sommet : où le bout libre de la corde doit venir s'accrocher, voir updateOdysseyBow(). -->
        <line x1="98" y1="13" x2="122" y2="27" class="odyssey-notch"/>
        <path id="odysseyBowPath" class="odyssey-bow-path" d=""/>
        <path id="odysseyStringPath" class="odyssey-string-path" d=""/>
        <circle id="odysseyStringEnd" class="odyssey-string-end" cx="0" cy="0" r="4"/>
      </svg>
      <div class="odyssey-track"><div class="odyssey-fill" id="odysseyFill"></div></div>
      <button class="btn odyssey-bend-btn" id="odysseyBendBtn" type="button">BANDE-LE !</button>
    </div>
  `;document.body.appendChild(overlay);let tension=0;let won=false;const fill=document.getElementById(`odysseyFill`);const caption=document.getElementById(`odysseyCaption`);const bendBtn=document.getElementById(`odysseyBendBtn`);updateOdysseyBow(0);const decay=setInterval(()=>{if(won)return;tension=Math.max(0,tension-ODYSSEY_DECAY);fill.style.width=tension+`%`;updateOdysseyBow(tension)},ODYSSEY_TICK_MS);function stopWatching(){clearInterval(decay);overlay.remove()}overlay.addEventListener(`click`,e=>{if(e.target===overlay||e.target.closest(`[data-close]`))stopWatching()});function bend(){if(won)return;tension=Math.min(100,tension+ODYSSEY_GAIN);fill.style.width=tension+`%`;updateOdysseyBow(tension);if(tension>=100){won=true;clearInterval(decay);caption.textContent=`« Aucun de vous n'était digne de bander cet arc. » Toi, si.`;bendBtn.disabled=true;bendBtn.textContent=`ÉPREUVE RÉUSSIE`;showToast(`Tu es digne d'Ithaque 🏹`)}}bendBtn.addEventListener(`click`,bend);bendBtn.addEventListener(`touchstart`,e=>{e.preventDefault();bend()},{passive:false})}function runCityOfGodHappening(film){const overlay=document.createElement(`div`);overlay.className=`overlay open`;overlay.innerHTML=`
    <div class="modal happening-modal cog-modal">
      <div class="modal-head">
        <h2>Le défi photo, façon favela</h2>
        <button class="close-x" data-close aria-label="Fermer">✕</button>
      </div>
      <p class="happening-caption" id="cogCaption">Prends une photo, une vraie : qui raconte quelque chose, comme un plan de Cidade de Deus. On s'occupe de l'ambiance.</p>
      <div id="cogIntro">
        <input type="file" accept="image/*" capture="environment" id="cogPhotoInput">
      </div>
      <div id="cogResult" style="display:none;">
        <canvas class="cog-canvas" id="cogCanvas"></canvas>
        <div class="modal-footer">
          <div><button class="btn secondary" id="cogRetakeBtn" type="button">Reprendre</button></div>
          <div class="right"><button class="btn" id="cogDownloadBtn" type="button">Télécharger</button></div>
        </div>
      </div>
    </div>
  `;document.body.appendChild(overlay);overlay.addEventListener(`click`,e=>{if(e.target===overlay||e.target.closest(`[data-close]`))overlay.remove()});const photoInput=document.getElementById(`cogPhotoInput`);const intro=document.getElementById(`cogIntro`);const result=document.getElementById(`cogResult`);const caption=document.getElementById(`cogCaption`);const canvas=document.getElementById(`cogCanvas`);photoInput.addEventListener(`change`,()=>{const file=photoInput.files&&photoInput.files[0];if(!file)return;const url=URL.createObjectURL(file);const img=new Image;img.onload=()=>{renderCogPhoto(canvas,img,film);URL.revokeObjectURL(url);intro.style.display=`none`;result.style.display=``;caption.textContent=`Défi relevé. Télécharge-la, ou reprends-en une autre.`};img.onerror=()=>{URL.revokeObjectURL(url);showToast(`Photo illisible, réessaie.`)};img.src=url});document.getElementById(`cogRetakeBtn`).addEventListener(`click`,()=>{photoInput.value=``;result.style.display=`none`;intro.style.display=``;caption.textContent=`Prends une photo, une vraie : qui raconte quelque chose, comme un plan de Cidade de Deus. On s'occupe de l'ambiance.`});document.getElementById(`cogDownloadBtn`).addEventListener(`click`,()=>{canvas.toBlob(blob=>{const url=URL.createObjectURL(blob);const a=document.createElement(`a`);a.href=url;a.download=`critique-films-defi-photo-${film.title.toLowerCase().replace(/[^a-z0-9]+/g,`-`)}.png`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),4e3)},`image/png`)})}function renderCogPhoto(canvas,img,film){const maxW=900;const scale=Math.min(1,maxW/img.naturalWidth);const pw=Math.round(img.naturalWidth*scale);const ph=Math.round(img.naturalHeight*scale);const bandH=130;canvas.width=pw;canvas.height=ph+bandH;const ctx=canvas.getContext(`2d`);ctx.filter=`saturate(0.4) contrast(1.3) sepia(0.22) brightness(0.9)`;ctx.drawImage(img,0,0,pw,ph);ctx.filter=`none`;const vign=ctx.createRadialGradient(pw/2,ph/2,ph*.35,pw/2,ph/2,ph*.75);vign.addColorStop(0,`rgba(0,0,0,0)`);vign.addColorStop(1,`rgba(0,0,0,0.55)`);ctx.fillStyle=vign;ctx.fillRect(0,0,pw,ph);ctx.fillStyle=`rgba(237,228,211,0.06)`;for(let i=0;i<Math.round(pw*ph/900);i++){ctx.fillRect(Math.random()*pw,Math.random()*ph,1.4,1.4)}ctx.fillStyle=`#17140f`;ctx.fillRect(0,ph,pw,bandH);ctx.fillStyle=`#d1a13f`;ctx.font=`italic 600 ${Math.max(22,Math.round(pw/26))}px Georgia, serif`;ctx.textAlign=`left`;ctx.fillText(truncateCanvasTextOneLine(ctx,film.title,pw-56),28,ph+48);ctx.fillStyle=`#948c78`;ctx.font=`600 13px "IBM Plex Mono", monospace`;ctx.fillText(`DÉFI PHOTO RELEVÉ · CRITIQUE DE FILMS`,28,ph+bandH-20)}function wrapCanvasText(ctx,text,x,y,maxWidth,lineHeight,maxLines){const words=text.split(` `);let line=``;let curY=y;let lines=0;for(let i=0;i<words.length;i++){const testLine=line+words[i]+` `;if(ctx.measureText(testLine).width>maxWidth&&line){ctx.fillText(line,x,curY);line=words[i]+` `;curY+=lineHeight;lines++;if(maxLines&&lines>=maxLines-1){const rest=words.slice(i).join(` `);let truncated=rest;while(ctx.measureText(truncated+`…`).width>maxWidth&&truncated.length>1){truncated=truncated.slice(0,-1)}ctx.fillText(truncated.length<rest.length?truncated+`…`:truncated,x,curY);return}}else{line=testLine}}ctx.fillText(line,x,curY)}function truncateCanvasTextOneLine(ctx,text,maxWidth){if(ctx.measureText(text).width<=maxWidth)return text;let t=text;while(t.length>1&&ctx.measureText(t+`…`).width>maxWidth){t=t.slice(0,-1)}return t+`…`}function runSevenHappening(){const overlay=document.createElement(`div`);overlay.className=`overlay open`;overlay.innerHTML=`
    <div class="modal happening-modal">
      <div class="modal-head">
        <h2>📦 Une boîte, dans le désert.</h2>
        <button class="close-x" data-close aria-label="Fermer">✕</button>
      </div>
      <p class="happening-caption" id="sevenCaption">John Doe a livré son dernier colis. Mills insiste pour l'ouvrir.</p>
      <button class="btn" id="sevenOpenBtn" type="button">Ouvrir la boîte</button>
    </div>
  `;document.body.appendChild(overlay);overlay.addEventListener(`click`,e=>{if(e.target===overlay||e.target.closest(`[data-close]`))overlay.remove()});document.getElementById(`sevenOpenBtn`).addEventListener(`click`,()=>{document.getElementById(`sevenOpenBtn`).remove();document.getElementById(`sevenCaption`).textContent=`« Qu'est-ce qu'il y a dans la boîte ?! »`;if(!prefersReducedMotion()){overlay.classList.add(`seven-shake`);setTimeout(()=>overlay.classList.remove(`seven-shake`),400)}})}function runWhiplashHappening(){const overlay=document.createElement(`div`);overlay.className=`overlay open`;overlay.innerHTML=`
    <div class="modal happening-modal">
      <div class="modal-head">
        <h2>Pas tout à fait mon tempo.</h2>
        <button class="close-x" data-close aria-label="Fermer">✕</button>
      </div>
      <div class="whiplash-metronome">
        <div class="whiplash-metronome-arm${prefersReducedMotion()?` static`:``}"></div>
      </div>
      <p class="happening-caption">Encore une fois. Depuis le début.</p>
    </div>
  `;document.body.appendChild(overlay);overlay.addEventListener(`click`,e=>{if(e.target===overlay||e.target.closest(`[data-close]`))overlay.remove()})}function runPaprikaHappening(){const overlay=document.createElement(`div`);overlay.className=`overlay open`;overlay.innerHTML=`
    <div class="modal happening-modal">
      <div class="modal-head">
        <h2>La Parade</h2>
        <button class="close-x" data-close aria-label="Fermer">✕</button>
      </div>
      <div class="paprika-parade">
        <div class="paprika-parade-track${prefersReducedMotion()?` static`:``}">
          <span>🎺</span><span>🚪</span><span>🎎</span><span>📞</span><span>🐸</span><span>🎏</span><span>🕰️</span><span>🎻</span><span>🚪</span>
        </div>
      </div>
      <p class="happening-caption">Un défilé de rêve traverse la ville, frigos et jouets en fanfare, et la police n'y peut rien.</p>
    </div>
  `;document.body.appendChild(overlay);overlay.addEventListener(`click`,e=>{if(e.target===overlay||e.target.closest(`[data-close]`))overlay.remove()})}function runMissionImpossibleHappening(){const overlay=document.createElement(`div`);overlay.className=`overlay open`;overlay.innerHTML=`
    <div class="modal happening-modal">
      <div class="modal-head">
        <h2>Votre mission, si vous l'acceptez...</h2>
        <button class="close-x" data-close aria-label="Fermer">✕</button>
      </div>
      <p class="happening-caption" id="mimMessage">Ce message s'autodétruira dans <span id="mimCountdown">5</span> secondes.</p>
    </div>
  `;document.body.appendChild(overlay);overlay.addEventListener(`click`,e=>{if(e.target===overlay||e.target.closest(`[data-close]`))overlay.remove()});if(prefersReducedMotion()){document.getElementById(`mimMessage`).textContent=`Ce message s'est autodétruit.`;return}let n=5;const countdownEl=document.getElementById(`mimCountdown`);const timer=setInterval(()=>{if(!document.body.contains(overlay)){clearInterval(timer);return}n--;if(n<=0){clearInterval(timer);overlay.classList.add(`mim-burn`);setTimeout(()=>overlay.remove(),900);return}countdownEl.textContent=n},1e3)}function runDarkKnightHappening(){const overlay=document.createElement(`div`);overlay.className=`overlay open`;overlay.innerHTML=`
    <div class="modal happening-modal">
      <div class="modal-head">
        <h2>Pile ou face ?</h2>
        <button class="close-x" data-close aria-label="Fermer">✕</button>
      </div>
      <div class="dk-coin" id="dkCoin">🪙</div>
      <p class="happening-caption" id="dkCaption">« Tu fais ton propre destin. » Lance la pièce.</p>
      <button class="btn" id="dkFlipBtn" type="button">Lancer la pièce</button>
    </div>
  `;document.body.appendChild(overlay);overlay.addEventListener(`click`,e=>{if(e.target===overlay||e.target.closest(`[data-close]`))overlay.remove()});document.getElementById(`dkFlipBtn`).addEventListener(`click`,()=>{document.getElementById(`dkFlipBtn`).remove();const coin=document.getElementById(`dkCoin`);const reduced=prefersReducedMotion();if(!reduced)coin.classList.add(`flipping`);setTimeout(()=>{const caption=document.getElementById(`dkCaption`);if(caption)caption.textContent=`Les deux côtés sont identiques. Il n'a jamais vraiment laissé le hasard décider.`},reduced?0:900)})}function runTrumanShowHappening(){const overlay=document.createElement(`div`);overlay.className=`overlay open`;overlay.innerHTML=`
    <div class="modal happening-modal">
      <div class="modal-head">
        <h2>🚪 Un bout du monde, et une porte.</h2>
        <button class="close-x" data-close aria-label="Fermer">✕</button>
      </div>
      <div class="truman-sky" id="trumanSky"></div>
      <p class="happening-caption" id="trumanCaption">Truman regarde l'escalier qui monte vers le ciel peint.</p>
      <button class="btn" id="trumanDoorBtn" type="button">Monter les marches</button>
    </div>
  `;document.body.appendChild(overlay);overlay.addEventListener(`click`,e=>{if(e.target===overlay||e.target.closest(`[data-close]`))overlay.remove()});document.getElementById(`trumanDoorBtn`).addEventListener(`click`,()=>{document.getElementById(`trumanDoorBtn`).remove();document.getElementById(`trumanSky`).classList.add(`opened`);document.getElementById(`trumanCaption`).textContent=`« Au cas où je ne vous revois plus : bon après-midi, bonsoir, et bonne nuit. »`})}function runInceptionHappening(){const reduced=prefersReducedMotion();const overlay=document.createElement(`div`);overlay.className=`overlay open`;overlay.innerHTML=`
    <div class="modal happening-modal">
      <div class="modal-head">
        <h2>🌀 Elle tourne encore.</h2>
        <button class="close-x" data-close aria-label="Fermer">✕</button>
      </div>
      <div class="inception-top${reduced?` static`:``}">🌀</div>
      <p class="happening-caption">Ferme cette fenêtre avant de savoir si elle tombe. Tu ne sauras jamais.</p>
    </div>
  `;document.body.appendChild(overlay);overlay.addEventListener(`click`,e=>{if(e.target===overlay||e.target.closest(`[data-close]`))overlay.remove()})}function runParasiteHappening(){const reduced=prefersReducedMotion();const overlay=document.createElement(`div`);overlay.className=`overlay open`;overlay.innerHTML=`
    <div class="modal happening-modal">
      <div class="modal-head">
        <h2>🪨 Il continue de me suivre.</h2>
        <button class="close-x" data-close aria-label="Fermer">✕</button>
      </div>
      <div class="parasite-rock${reduced?` static`:``}" id="parasiteRock">🪨</div>
      <p class="happening-caption" id="parasiteCaption">Min le lui avait offert pour porter chance. Ki-woo ne l'a plus jamais lâché, même dans l'eau qui monte.</p>
      <button class="btn" id="parasitePlanBtn" type="button">Faire le plan</button>
    </div>
  `;document.body.appendChild(overlay);overlay.addEventListener(`click`,e=>{if(e.target===overlay||e.target.closest(`[data-close]`))overlay.remove()});document.getElementById(`parasitePlanBtn`).addEventListener(`click`,()=>{document.getElementById(`parasitePlanBtn`).remove();document.getElementById(`parasiteRock`).classList.add(`sunk`);document.getElementById(`parasiteCaption`).textContent=`Je vais gagner beaucoup d'argent, et un jour, sans un mot, j'achète cette maison. Papa n'aura qu'à descendre l'escalier.`})}