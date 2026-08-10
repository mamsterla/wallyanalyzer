function WallySine(mat,EL,OA,OH,MY)

% 2025 07 07 CompileSine24.m (from ...22) detect a CCW play and fit to the
%   negative of Baerwald, this has an error in fitting to D2 slopes..
% 2025 07 18 CompileSine25.m for Amster, with some corrections to fitting
%   across mount yaw at end for a "sweep" of files across mount yaw
% 2025 07 23 CompileSine26.m (from ...24) fix fitting slopes to D2
% 2026 06 15 WallySine01
plotflag=1;
ii=1; %for consistancy with previous version
if nargin<1
    mat='MeasureSine33_Play30_c64_p11.mat';
    EL=280;
    OA=19.495;
    OH0=14.63;
    MY=0;
end
warning('off','MATLAB:handle_graphics:exceptions:SceneNode');

Omega=100/3*2*pi/60; %radians/s angular velocity of rotation m

load(mat);
V0=5.5*.01; %m/s, cut velocity over riding that from MeasureSine
nrot=round(360/skip(1)); %number of points in one rotation
navg=16;

[Mn,Sig,igood,ibad,x]=choose(lag,4); %lag can have bad misses other than nan's
lag(ibad)=nan;
hit=find(~isnan(lag)); %list of valid snippet measurements
dr=(rend-rbeg)/(length(lag)-1);
%    is=1:is; %is is actually saved (is(end)) so this reconstructs it
%    r=@(is) (rbeg-pitch(end)/360*skip*(is)); %radius in mm vs. sample
rs=rbeg:dr:rend; %reconstructed hypothetical LP radii
%    disp(num2str([rbeg rend rbeg-rend rs([end 1]) is(end)]))
Rs=rs(hit); %radii with good measurements
Lag=lag(hit); %good K=LR lags of snippets
F=F(hit,:); %frequencies of good snippets
Hd=H(hit,:); %fundamental, 2nd and 3rd harmonic amplitudes
lavg=nrot*navg;
LAG=conv(Lag,ones(1,nrot*navg)/(nrot*navg),'valid'); %denoised
PITCH=pitch(end); %from estimate in mat.  a rev had 2 pitches?
RS=conv(Rs,ones(1,nrot*navg)/(nrot*navg),'valid'); %denoised
%disp(RS([1 end]));
HD=conv2(Hd,ones(nrot*navg,1)/(nrot*navg),'valid'); %denoised
if RS(1)<RS(end)
    rot=-1; %for CCW rotation
else
    rot=1; %normal, for CW rotation of LP
end
options=optimset('fminsearch');
LR0=10; %m->um, estimate from mat will be revised
SY0=0;
p0=[LR0 SY0 OH0]; %SY is actually SY+CY, i.e., the compensated number
baers=@(oh) rot*baerwaldTE(RS,EL,OA,oh,0,0);

for ii=1:2; %one pass of choosing valid data
    mod=@(p) 9e-4/pi./RS*p(1).*...
        sind(rot*baers(p(3))+p(2)); %for LAG
    err=@(p) (LAG-mod(p)); %model error
    RMS=@(p) rms(err(p)); % L2 norm.  ???Should it be L1???
    [p2,Pval,Pexit,Pout]=fminsearch(@(p) RMS(p),p0,options);
    ELR=p2(1); %effective stylus width
    ESY=p2(2); %measured (fit), effective stylus yaw wrt groove
    EOH=p2(3); %measured (fit), overhang
    LAGfit=mod(p2);
    %sigr=rms(LAGfit(:)-LAG(:)); %==Pval
    PYmeas=asind(1000*pi*RS.*LAG/0.9/ELR);
    PYfit=rot*baers(EOH)+ESY+MY;
    Lag2PY=polyfit(LAGfit,PYfit,1);
    dif=PYmeas(:)-PYfit(:);
    sd=stdnan(dif);
    mis=abs(dif)>sd;
    if length(mis)==0; break; end
    LAG(mis)=nan;
end

%[Styl zen(deg), Lathe Offset(mm), Stylus LR width]
%https://www.tonmeister.ca/wordpress/2023/07/20/tonearm-tracking-error-and-distortion/
atemeas=@(lr) asind(1000*pi*RS.*LAG/0.9/lr); % from conv(tlag) & LR
%            mm s / s / m / 1000 = 1, mm/1000=m
%          [eps,r]=baerwaldTE(r,L,OA,OH,LO,plotflag);
%model lag angle: baerwald does not include mismounted cartridge or stylus
atemod=@(p) rot*baerwaldTE(RS,EL,OA,p(3),0,0)+p(2)+MY;
err=@(p) (atemeas(p(1))-atemod(p)); %model error
RMS=@(p) rms(err(p)); % L1 norm.  ???Should it be L2???
[p2,Pval,Pexit,Pout]=fminsearch(@(p) RMS(p),p0,options);

ELR=p2(1); %effective stylus width
ESY=p2(2); %measured (fit), effective stylus yaw wrt groove
EOH=p2(3); %measured (fit), OH
RMSfit=Pval; %error fitting to Baerwald
%baer00 is the tracking error of the setup to predict distortion
%  /wo fitting exclude LO to get tracking error
baer00=baerwaldTE(RS,EL,OA,EOH,0,0);
D=V0*tand(baer00)./RS*1000/Omega; % " as part of fit yaw error
ATEmeas=atemeas(ELR);
ATEfit=atemod(p2);
ATEraw=asind(pi*rs(hit).*Lag/0.9/ELR*1000); % - sign?
noise=ATEraw(lavg/2+1:(end-lavg/2+1))-ATEmeas;
Noise=3*std(noise);
D2=HD(:,2)./HD(:,1);
[ATEpk0,iATEpk]=max(abs(ATEfit)); %max abs ATE
[ATEpos0,iATEpos]=max((ATEfit)'); %max  ATE
ATEsign=sign(ATEfit(iATEpk));
ATErng=max(ATEfit)-min(ATEfit); %max abs ATE
ATEmean=mean(ATEfit);
Rms=RMS(p2);
if plotflag
    figure; halffig;
    h=subplot(2,1,1);
    ho=plot(Rs,ATEraw,':','color',[0.9290    0.6940    0.1250]);
    hold on;
    plot(RS,ATEmeas,'b','LineW',1.5)
    plot(RS,ATEfit,'--','Color',green,'LineW',2)
    plot(RS(iATEpk),ATEfit(iATEpk),'o','Color','b')
    % plot(RS,baer,'r--','LineW',2);
    axis tight; grid on; ax(ii,:)=axis;
    ylabel({['Apparent Tracking Error (^o)']});
    set(gca,'XTickLabel',[]);
    pos=get(gca,'Pos');
    hx=xlabel({['Mount: Z=' num2str(MY,3) '^o, L='...
        num2str(EL,4) 'mm, ATEfit: SY=' num2str(p2(2),3) '^o, '...
        'LR=' num2str(p2(1),3) '\mum'],...
        ['OH=' num2str(EOH,4) 'mm, max||=' num2str(ATEpk0,3) '^o, |ATE|='...
        num2str(ATEmean,3)],...
        ['RMSfit=' num2str(RMSfit,4) 'mm, '...
        int2str(Mperiod) 'cycles of 1kHz every '...
        int2str(skip) '^o']});
    set(gca,'Pos',pos);
    hl=legend(['ATEraw\pm' num2str(Noise,3)],...
        [int2str(nrot) 'rot avg'],['ATEfit\pm'...
        num2str(3*Rms,3) '^o'],...
        'Location','best'); set(hl,'Box','off');
    xl=xlim(gca);
    title({['Wally Analysis, ' file]});
    
    h(2)=subplot(2,1,2); cla;
    h4(1)=plot(RS,100*HD(:,2)./HD(:,1),'.:'); %2nd har.dis.
    hold on;                                                %la
    h4(2)=plot(RS,100*HD(:,3)./HD(:,1),'.:'); %3rd har.dis
    h4(3)=plot(RS,abs(D)*100,'k--','LineWidth',1.5); %theory
    %        h4(4)=plot(RS,abs(Dfit)*100,'g:','LineWidth',1.5,...
    %            'Color',green); %questionable fit
    axis tight; grid on; xlim(xl); ylim([0 5]);

    legend(['<2^{nd}>=' num2str(mean(HD(:,2)./HD(:,1))*100,4) '%'],...
        ['<3^{rd}>=' num2str(mean(HD(:,3)./HD(:,1))*100,4) '%'],...
        ['Dist.Param(' num2str(V0*100,3) 'cm/s)'],...
        'Location','best')
    %    ['Fit: ' num2str(dp2(ii,:),3)],...
    ylabel('% Harmonic distortion');
    xlabel({['r (mm)']});
    hr=righttext({[pwdshort(2,which(mfile.name)) '    ' ...
        datestr(mfile.date)],[datestr(now) '   '...
        pwdshort(2,which(mfilename))]});
end


keyboard







