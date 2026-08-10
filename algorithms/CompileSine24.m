function CompileSine
% Compiles results from MeasureSine...m on experimental data
% 2024 11 23 FitZenith10.m switch to fitting to lag with SZ, CZ, LO, & LR
%   floating and not Overhang: CZ and SZ correlate badly
% 2024 11 25 ...11.m float only SZ, LO, & LR to break correlation,
% 2024 11 25 FitZenith12.m clean up legend on plot of apparent zenith
%               13.m try to read https://d.docs.live.net/65119D0E52ED5E6B
% SZ: stylus zenith, rotation of stylus mounted on the cantilever
% CZ: cantilever zenith, rotation of cantilever at null point
% PZ(R): playback zenith, variation of zenith from null point
% 2024 12 04 CompileSine05y largely works with bugs fixed based on linear
% model of distortion and some display deficiencies.
% 2024 12 04 CompileSine05x fix some display issues but still have
% inconsistency between variables for peak and rms, and sparse fit to rms
% 2024 12 06 ...04w get peak and rms to both give reasonable answers.
% 2024 12 06 ...04v shift to distortion squared
%   punt RMS: 1) PK is consistent with Baerwald min max, 2) CompileSine04x
%     showed that PK fits as well as RMS
% 2024 12 09 CompileSine10z.m preparation to fit for SZ, CZ, OH, L, works
% 2024 12 11 CompileSine10.m fit for SZ, CZ, OH, L
% 2024 12 12 CompileSine11.m only fit for LR and SZ
% 2024 12 13 CompileSine12.m update info on figure
% 2024 12 19 CompileSine12.m + MeasureSine10a
% 2025 01 31 CompileSine15.m + MeasureSine10a add cartridge and system doc
% 2025 02 07 CompileSine16.m "Lag" label->apparent TE, exclude ATE fliers,
%   report noise removed by averaging in the legend
% 2025 05 31 CompileSine17.m the distortion summary plot is wrong or at
%   least misleading
% 2025 05 31 CompileSine18.m try to come up with better summary plots but
%   the fits do not show clean minima at cartridge yaws where we want them
% 2025 06 03 CompileSine19.m try using minimum of fit Baerwald as the
%   parameter quantifying apparent stylus yaw
% 2025 06 09 CompileSine21.m *realize* that peak yaws and distortions are
%   linear in yaw, not quadratic, confirmed with touchLP....  Also flip
%   axes for ATE and distortion
% 2025 06 16 CompileRTI00.m modify to short scans in reverse directions
% 2025 06 28 CompileSine21.m linear fits to yaws instead of quadratic (*I
%   think* !-)
% 2025 07 07 CompileSine22.m  I *think* this was made in a hurry to process
%  not lacquers, but the Lathe signals going to the cutter head, i.e., a
%  dead end
% 2025 07 07 CompileSine24.m (from ...22) detect a CCW play and fit to the
%   negative of Baerwald
% 2025 07 18 CompileSine25.m for Amster, with some corrections to fitting
%   across mount yaw at end for a "sweep" of files across mount yaw
warning('off','MATLAB:handle_graphics:exceptions:SceneNode');
savefile=[mfilename '.mat'];
if 0 %C:\Users\Fred Stanke\OneDrive\Documents\hifi\PhonoTracking\Repeatability\Round5lacquer
    mats={ %sweep including positive CZs
        'MeasureSine12_Play50_c64_p11.mat',...
        'MeasureSine12_Play32_c64_p11.mat',...
        'MeasureSine12_Play30_c64_p11.mat'...
        'MeasureSine12_Play31_c64_p11.mat'...
        };
elseif 1
mats={...
    'MeasureSine14_heyLac2P07_c64_p11.mat',...
    'MeasureSine14_heyLac2P08_c64_p11.mat',...
    'MeasureSine14_heyLac2P09_c64_p11.mat',...
    'MeasureSine14_heyLac2P10_c64_p11.mat',...
    'MeasureSine14_heyLac2P11_c64_p11.mat',...
    'MeasureSine14_heyLac2P12_c64_p11.mat'  };
elseif 0
%\PhonoTracking\Repeatability\Lacquer002
%    'MeasureSine14_RTI2P28_c64_p11.mat',...

mats={...
    'MeasureSine14_RTI2P29_c64_p11.mat',...
    'MeasureSine14_RTI2P32_c64_p11.mat'};

elseif 0
    mats=...
        {'MeasureSine14_RTI1P1_c64_p11.mat'};
elseif 0
%\PhonoTracking\Repeatability\Round4Lacquer
    
    mats={ 
        'MeasureSine14_Play06_c64_p11.mat',...
        'MeasureSine14_Play09_c64_p11.mat'
    };

end
TrackPath='C:\Users\Fred Stanke\OneDrive\Documents\hifi\PhonoTracking\Repeatability\Round4lacquer\';
Tracker='Research Recording Tracking Sheet.xlsx';
disp(['CLOSE ' pwdshort(3,[TrackPath Tracker])]);
[AcqData,AcqText]=xlsread([TrackPath Tracker],1);
jFile=cellfind(regexp(AcqText(1,:),'File'));
jSystem=cellfind(regexp(AcqText(1,:),'System'));
jCartridge=cellfind(regexp(AcqText(1,:),'Cartridge'));
jCY=cellfind(regexpi(AcqText(1,:),'Wally Zenith')); %cantilever zenith
jSY=cellfind(regexpi(AcqText(1,:),'Stylus ZE')); %stylus zenith
ii=3;
jFile=ii; ii=ii+1;
jDate=ii; ii=ii+1;
jSys=ii; ii=ii+1;
jCart=ii; ii=ii+1; %Cartridge
jWZ=ii; ii=ii+1; %Wally Zenith
jSY=ii; ii=ii+1; %Stylus Zenith
jEL=ii; ii=ii+1; %effective length, intended
jOA=ii; ii=ii+1; %offset angle, intended
jOH=ii; ii=ii+1; %offset angle, intended
jROH=ii; ii=ii+1; %required overhang
jDOH=ii; ii=ii+1; %Overhang adjustment
jDEL=ii; ii=ii+1; %Effective length adjustment
jP2S=ii+1; ii=ii+1; %Actual Pivot to spindle
jTest=ii+1; ii=ii+1; %Test Track
jDAC=ii+1; ii=ii+1; %Digitizer
jCom=ii+1; %Comments
[CartridgeData,CartridgeText]=xlsread([TrackPath Tracker],4);
[SystemData,SystemText]=xlsread([TrackPath Tracker],3);
ii=2;
jTT=ii; ii=ii+1;
jTA=ii; ii=ii+1;
jHS=ii; ii=ii+1;
jShim=ii; ii=ii+1;
jIso=ii; ii=ii+1;
jSysNotes=ii;
ii=1;
jCartridges=ii; 
jLR=ii; ii=ii+1;
jZE=ii; ii=ii+1;
jWZcart=ii; ii=ii+1;
jSRA=ii; ii=ii+1;
jVTA=ii; ii=ii+1;
plotflag=1;
navg=16;
LO0=0; %-3.33: 0 assume small finite unknown, ~0 assume known, lathe centering error
files=AcqText(2:end,jFile);
Omega=100/3*2*pi/60; %radians/s angular velocity of rotation m
clear LRs

for ii=1:length(mats)
    mat=mats{ii};
    disp(mat);
    load(mat);
    V0=5.5*.01; %m/s, cut velocity over riding that from MeasureSine
    nrot=round(360/skip(1)); %number of points in one rotation
    [PATHSTR,NAME{ii},EXT]=fileparts(file); %.wav file
    iFile=cellfind(regexpi(files,NAME{ii})); % this file's name is in the mat
    iFile=iFile(end); %stupid patch for muliple mat's from same wav
    SYS(ii)=AcqData(iFile,jSys-1); %Data columns are 2 less than Text cols
    Cart{ii}=AcqText{iFile+1,jCart}; %the numbering for text must be different
    CY(ii)=AcqData(iFile,jWZ-1); %Data columns are 2 less than Text cols
    SY(ii)=-AcqData(iFile,jSY-1); %JR measures this with stylus upside down
    EL(ii)=AcqData(iFile,jEL-1); %effective length, ess. manu. spec.
    OA(ii)=AcqData(iFile,jOA-1); %offset angle, "
    OH0(ii)=AcqData(iFile,jOH-1); % typ. Baerwald
    % requested overhang:
    ROH(ii)=AcqData(iFile,jROH-1); if isnan(ROH(ii)), ROH(ii)=0; end
    % delta overhang adjustment in headshell to achieve ROH
    DOH(ii)=AcqData(iFile,jDOH-1); if isnan(DOH(ii)), DOH(ii)=0; end
    % delta overhang adjustment in spindle2pivot distance to achieve ROH
    DPS(ii)=AcqData(iFile,jDEL-1); if isnan(DPS(ii)), DPS(ii)=0; end
    % P2S target based on deltas, redundant data
    P2S(ii)=AcqData(iFile,jP2S-1); if isnan(P2S(ii)), P2S(ii)=0; end
    Cartridges=CartridgeText(3:end,jCartridges);
    iCart=cellfind(regexpi(Cartridges,Cart{ii})); % this file's name is in the mat
    LR(ii)=CartridgeData(iCart,jLR);
    %if isnan(LR(ii)
    iSys=find(SystemData,SYS(ii));
    Tt{ii}=SystemText{iSys+2,jTT};
    TA{ii}=SystemText{iSys+2,jTA};
    HS{ii}=SystemText{iSys+2,jHS};
    Shim{ii}=SystemText{iSys+2,jShim};
    Iso{ii}=SystemText{iSys+2,jIso};
    System{ii}=SystemText{iSys+2,jSysNotes};
    
    %PS0=EL(ii)-OH0(ii);
    %EL0=EL(ii)+DOH(ii);
    OH1(ii)=OH0(ii)+DOH(ii)-DPS(ii);
    
    % delete: if ii==1, OH0=OH; end %for this test just use standard OHs
    [Mn,Sig,igood,ibad,x]=choose(lag,4); %lag can have bad misses other than nan's
    lag(ibad)=nan;
    hit{ii}=find(~isnan(lag)); %list of valid snippet measurements
    dr(ii)=(rend-rbeg)/(length(lag)-1);
    %    is=1:is; %is is actually saved (is(end)) so this reconstructs it
    %    r=@(is) (rbeg-pitch(end)/360*skip*(is)); %radius in mm vs. sample
    rs{ii}=rbeg:dr(ii):rend; %reconstructed hypothetical LP radii
    %    disp(num2str([rbeg rend rbeg-rend rs{ii}([end 1]) is(end)]))
    Rs{ii}=rs{ii}(hit{ii}); %radii with good measurements
    Lag=lag(hit{ii}); %good K=LR lags of snippets
    F=F(hit{ii},:); %frequencies of good snippets
    Hd{ii}=H(hit{ii},:); %fundamental, 2nd and 3rd harmonic amplitudes
    lavg=nrot*navg;
    LAG{ii}=conv(Lag,ones(1,nrot*navg)/(nrot*navg),'valid'); %denoised
    PITCH(ii)=pitch(end); %from estimate in mat.  a rev had 2 pitches?
    RS{ii}=conv(Rs{ii},ones(1,nrot*navg)/(nrot*navg),'valid'); %denoised
    %disp(RS{ii}([1 end]));
    HD{ii}=conv2(Hd{ii},ones(nrot*navg,1)/(nrot*navg),'valid'); %denoised
    if RS{ii}(1)<RS{ii}(end)
        rot=-1; %for CCW rotation
    else
        rot=1; %normal, for CW rotation of LP
    end
    options=optimset('fminsearch');
    LR0=LR; %m->um, estimate from mat will be revised
    if abs(EL(ii)-OH1(ii)-P2S(ii))>.001 % check consistency of setup
        bopper warn; disp('EL OH and P2S inconsistent'); keyboard;
    end
    p0=[LR0 SY(ii)]; %SY is actually SY+CY, i.e., the compensated number
    %[Styl zen(deg), Lathe Offset(mm), Stylus LR width]
    %https://www.tonmeister.ca/wordpress/2023/07/20/tonearm-tracking-error-and-distortion/
    atemeas=@(lr) asind(1000*pi*RS{ii}.*LAG{ii}/0.9/lr); % from conv(tlag) & LR
    %            mm s / s / m / 1000 = 1, mm/1000=m
    %          [eps,r]=baerwaldTE(r,L,OA,OH,LO,plotflag);
    %model lag angle: baerwald does not include mismounted cartridge or stylus
    atemod=@(sz) rot*baerwaldTE(RS{ii},EL(ii),OA(ii),OH1(ii),0,0)+sz+CY(ii); 
    err=@(p) (atemeas(p(1))-atemod(p(2))); %model error
    %errT=@(p) (atemeas(p(2))-atemod(p(1)))'.^2; %for Jacobians but not used
    RMS=@(p) rms(err(p)); % L1 norm.  ???Should it be L2???
    [p2{ii},Pval,Pexit,Pout]=fminsearch(@(p) RMS(p),p0,options);
    if 0
        [A,z]=jacobianest(err,p2{ii});
        %https://stats.stackexchange.com/questions/20240/how-to-get-a-confidence-interval-on-parameters-that-were-fitted-using-multiple-f
        sig=Pval*sqrt(inv(A'*A));
    end
    ELR(ii)=p2{ii}(1); %effective stylus width
    ESY(ii)=p2{ii}(2); %measured (fit), effective stylus yaw wrt groove
    RMSfit(ii)=Pval; %error fitting to Baerwald
    %baer00 is the tracking error of the setup to predict distortion 
    %  /wo fitting exclude LO to get tracking error
    baer00=baerwaldTE(RS{ii},EL(ii),OA(ii)-CY(ii),OH1(ii),0,0); 
    D{ii}=V0*tand(baer00)./RS{ii}*1000/Omega; % " as part of fit yaw error
    ATEmeas{ii}=atemeas(ELR(ii));
    ATEfit{ii}=atemod(ESY(ii));
    ATEraw{ii}=asind(pi*rs{ii}(hit{ii}).*Lag/0.9/ELR(ii)*1000); % - sign?
%    lagfit=sind(ATEfit{ii})*.9*ELR(ii)/1000/pi./RS{ii};
    noise=ATEraw{ii}(lavg/2+1:(end-lavg/2+1))-ATEmeas{ii};
    Noise=3*std(noise);
        D2{ii}=HD{ii}(:,2)./HD{ii}(:,1);
    dp0=[CY(ii),OH1(ii)];
    dist=@(dp) V0*tand(baerwaldTE(RS{ii},EL(ii),OA(ii)-dp(1),dp(2),0,0))./...
        RS{ii}*1000/Omega;
    [dp2(ii,:),PDval,PDexit,PDout]=...
        fminsearch(@(dp) sum((abs(dist(dp))'-abs(D2{ii})).^2),dp0,options); %fit to distortion
    Dfit{ii}=dist(dp2(ii,:));
    %???ATEmean(ii)=mean(abs(p2{ii}));
    [ATEpk0(ii),iATEpk(ii)]=max(abs(ATEfit{ii})); %max abs ATE
    [ATEpos0(ii),iATEpos(ii)]=max((ATEfit{ii})'); %max  ATE
    ATEsign(ii)=sign(ATEfit{ii}(iATEpk(ii)));
    ATErng(ii)=max(ATEfit{ii})-min(ATEfit{ii}); %max abs ATE
    ATEmean(ii)=mean(ATEfit{ii});
    Rms(ii)=RMS(p2{ii});
    if plotflag
        figure; halffig;
        h=subplot(2,1,1);
        ho=plot(Rs{ii},ATEraw{ii},':','color',[0.9290    0.6940    0.1250]);
        hold on;
        plot(RS{ii},ATEmeas{ii},'b','LineW',1.5)
        plot(RS{ii},ATEfit{ii},'--','Color',green,'LineW',2)
        plot(RS{ii}(iATEpk(ii)),ATEfit{ii}(iATEpk(ii)),'o','Color','b')
        % plot(RS,baer,'r--','LineW',2);
        axis tight; grid on; ax(ii,:)=axis;
        ylabel({['Apparent Tracking Error (^o)']});
        set(gca,'XTickLabel',[]);
        pos=get(gca,'Pos');
        hx=xlabel({['Mount: Z=' num2str(CY(ii),3) '^o, L='...
            num2str(EL(ii),4) 'mm , \DeltaPivSpin=' num2str(DPS(ii),4)...
            'mm, OH=' num2str(OH1(ii)) 'mm'],...
            ['ATEfit: SY=' num2str(p2{ii}(2),3) '^o, '...
            'LR=' num2str(p2{ii}(1),3) '\mum, max||='...
            num2str(ATEpk0(ii),3) '^o, |ATE|='...
            num2str(ATEmean(ii),3)],...
            ['RMSfit=' num2str(RMSfit(ii),4) 'mm, '...
            int2str(Mperiod) 'cycles of 1kHz every '...
            int2str(skip) '^o']});
        set(gca,'Pos',pos);
        hl=legend(['ATEraw\pm' num2str(Noise,3)],...
            [int2str(nrot) 'rot avg'],['ATEfit\pm'...
            num2str(3*Rms(ii),3) '^o'],...
            'Location','best'); set(hl,'Box','off');
        xl=xlim(gca);
        title({strvcat(breakstring(pwdshort(2,which(file)),-50)),...
            [System{ii} ', ' Cart{ii} ', ' TA{ii} ', ' Tt{ii}]});
        
        h(2)=subplot(2,1,2); cla;
        h4(1)=plot(RS{ii},100*HD{ii}(:,2)./HD{ii}(:,1),'.:'); %2nd har.dis.
        hold on;                                                %la
        h4(2)=plot(RS{ii},100*HD{ii}(:,3)./HD{ii}(:,1),'.:'); %3rd har.dis
        h4(3)=plot(RS{ii},abs(D{ii})*100,'k--','LineWidth',1.5); %theory
%        h4(4)=plot(RS{ii},abs(Dfit{ii})*100,'g:','LineWidth',1.5,...
%            'Color',green); %questionable fit 
        axis tight; grid on; ylim([0 3]); xlim(xl);
        if 0
            ht=title({['Mount yaw ' num2str(CY(ii),3) '^o for ' num2str(RS{ii}(1),5)...
                '\geqR\geq' num2str(RS{ii}(end),5)],[int2str(ns) ' ' ...
                int2str(Mperiod) 'cycle/' num2str(noi/Nrev*360,4) '^o '...
                '1kHz bursts (FWHM=' num2str(FWHM,3) '^o) @ '...
                int2str(skip) '^o']},'FontWeight','n')
        end
        legend(['<2^{nd}>=' num2str(mean(HD{ii}(:,2)./HD{ii}(:,1))*100,4) '%'],...
            ['<3^{rd}>=' num2str(mean(HD{ii}(:,3)./HD{ii}(:,1))*100,4) '%'],...
            ['Dist.Param(' num2str(V0*100,3) 'cm/s)'],...
                    'Location','best')
%    ['Fit: ' num2str(dp2(ii,:),3)],...
        ylabel('% Harmonic distortion');
        xlabel({['r (mm)']});
        hr=righttext({[pwdshort(2,which(mfile.name)) '    ' ...
            datestr(mfile.date)],[datestr(now) '   '...
            pwdshort(2,which(mfilename))]});
        linkaxes(h,'x')
        subtext(breakstring(AcqText{iFile+1,jCom},70),-9,-3.5);
        zoom xon
    end
end
%save(savefile);
if length(mats)<3, bopper warn; keyboard; end
if 0 %diagnostic
    figure; hold on;
    for ii=1:length(mats),
        hd(ii)=plot(RS{ii},D2{ii});
    end
end

for ii=1:length(mats);
    D2pk0(ii)=max(D2{ii})*100;
    D2rms0(ii)=rms(D2{ii})*100;
end
CY0=CY;
[CY,isort]=sort(CY);
D2pk=D2pk0(isort);
D2rms=D2rms0(isort);
% ATEpk&pos deal with max |ATE| jumping between most positive and most 
%  negative.
ATEpk=ATEpk0(isort); 
ATEpos=ATEpos0(isort); 
ipos=find(ATEpos==ATEpk);
ineg=find(ATEpos~=ATEpk);
ofit=4;

disp('PEAK distortion criterion'); %assuming quadratic behavior
cf=gcf;  
[coefD2PK,sigD2PK,igoodpk,ibadpk,fitpk,iterpk,figpk]=...
    choosepolyfit1(CY,D2pk,2,3,0);
%figure(figpk); lerase; xlabel('Cartridge yaw Angle (^o)');
%ylabel('Peak_R 2^{nd} Harmonic Distortion'); grid on;
CYfit=[min(CY):.1:max(CY)];
D2fit=polyval(coefD2PK,CYfit);
plot(CYfit,D2fit,'k--');
CYD2min=-coefD2PK(2)/2/coefD2PK(1); %the CY for minimum D2
D2min=polyval(coefD2PK,CYD2min);
plot(CYfit,D2fit,'k--');
plot(CYD2min,D2min,'k*');
legend('Data','Quad.Fit',['Min: [' num2str(CYD2min,3) ',' ...
    num2str(D2min,3) ']']);
CYD2good=CY(igoodpk); %the good CYs for D2

%fit ATE lines for low and high values of yaw
if length(ipos)>1 %max abs ATEs from positive values
[coefATEpos,sigATEpos,igoodATEpos,ibadATEpos,fitATEpos,iterATEpos,figATEpos]=...
    choosepolyfit1(CY(igoodpk(ipos)),ATEpk(igoodpk(ipos)),1,3,0);
%figure(figATEpos); grid on;
% xlabel('Cartridge yaw Angle (^o)');
% ylabel('Peak_R ATE'); 
elseif length(ipos)==1 
    coefATEpos=[1 ATEpk(igoodpk(ipos))+CY(igoodpk(ipos))];
elseif length(ipos)==0
    coefATEpos=[nan];
end

if length(ineg)>1 %max abs ATEs from negative values
[coefATEneg,sigATEneg,igoodATEneg,ibadATEneg,fitATEneg,iterATEneg,figATEneg]=...
    choosepolyfit1(CY(igoodpk(ineg)),ATEpk(igoodpk(ineg)),1,3,0);
%figure(figATEneg); grid on;
% xlabel('Cartridge yaw Angle (^o)');
% ylabel('Peak_R ATE'); 
elseif length(ineg)==1 
    coefATEneg=[-1 ATEpk(igoodpk(ineg))+CY(igoodpk(ineg))];
elseif length(ineg)==0
    coefATEneg=[nan];
end

if ~any(isnan([coefATEneg coefATEpos]))
    CYcross=(coefATEpos(2)-coefATEneg(2))/(-coefATEpos(1)+coefATEneg(1));
    CYneg=CY(igoodpk(ineg(1))):.1:CYcross;
    CYpos=CYcross:.1:CY(igoodpk(ipos(end)));
    ATEfitneg=polyval(coefATEneg,CYneg);
    ATEfitpos=polyval(coefATEpos,CYpos);
    ATEcross=ATEfitpos(1);
end % end fit ATE lines 

[D2sort,iD2sort]=sort(D2pk);
if iD2sort(2)>iD2sort(1) %real min is to left of apparent min
    ilow=1:iD2sort(1); ihigh=iD2sort(2):length(D2pk);
else %
    ihigh=1:iD2sort(2); ihigh=iD2sort(1):length(D2pk);
end
%fit D2 lines for low and high values of yaw
if length(ihigh)>1 %max abs D2s from high values
[coefD2high,sigD2high,igoodD2high,ibadD2high,fitD2high,iterD2high,figD2high]=...
    choosepolyfit1(CY(igoodpk(ihigh)),D2pk(igoodpk(ihigh)),1,3,0);
%figure(figD2high); grid on;
%xlabel('Cartridge yaw Angle (^o)');
%ylabel('Peak_R D2'); 
elseif length(ihigh)==1 
    coefD2high=[1 D2pk(igoodpk(ihigh))+CY(igoodpk(ihigh))];
elseif length(ihigh)==0
    coefD2high=[nan];
end

if length(ilow)>1 %max abs D2s from lowative values
[coefD2low,sigD2low,igoodD2low,ibadD2low,fitD2low,iterD2low,figD2low]=...
    choosepolyfit1(CY(igoodpk(ilow)),D2pk(igoodpk(ilow)),1,3,0);
%figure(figD2low); grid on;
%xlabel('Cartridge yaw Angle (^o)');
%ylabel('Peak_R D2'); 
elseif length(ilow)==1 
    coefD2low=[-1 D2pk(igoodpk(ilow))+CY(igoodpk(ilow))];
elseif length(ilow)==0
    coefD2low=[nan];
end

if ~any(isnan([coefD2low coefD2high]))
    CYD2cross=(coefD2high(2)-coefD2low(2))/(-coefD2high(1)+coefD2low(1));
    CYD2low=CY(igoodpk(ilow(1))):.1:CYD2cross;
    CYD2high=CYD2cross:.1:CY(igoodpk(ihigh(end)));
    D2fitlow=polyval(coefD2low,CYD2low);
    D2fithigh=polyval(coefD2high,CYD2high);
    D2cross=D2fithigh(1);
end % end fit D2 lines 

figure; halffig;
subplot(2,1,1);

h41=plot(CY(igoodpk),ATEpk(igoodpk),'bo'); hold on;
h43=plot(CYneg,ATEfitneg,'k--');
h44=plot(CYpos,ATEfitpos,'r-.');
h45=plot(CYcross,ATEfitpos(1),'b*');
h42=plot(CY(ibadpk),ATEpk(ibadpk),'bx');
grid on;

if isempty(ibadpk)
    legend([h41 h43 h44 h45],...
      'Data',['Slope: ' num2str(coefATEneg(1),3)],...
      ['Slope: ' num2str(coefATEpos(1),3)],...
      [mat2str([CYcross,ATEcross],3) ...
      '^o'],'Location','best');
else
    legend([h41 h42 h45 h46],'Data','Fliers',['ATEfit: \sigma/max='...
        num2str(sigATEpk,3)],...
        ['MZ_{best}=' num2str(ATEmin,3) '^o'],...
        'Location','best');
end
ylabel(['max_{radius}|ATE| (^o)'])
xlabel(['Cartridge Mount Yaw (^o)), <LR>='... 
    num2str(mean(ELR(igoodpk)),4) '\mum, \sigma_{LR}='...
    num2str(std(ELR(igoodpk)),4) '\mum']);
title(breakstring(pwdshort(2,which(file)),-50));

subplot(2,1,2);
h31=plot(CY,D2pk,'bo'); hold on;
h33=plot(CYD2low,D2fitlow,'b-');
h34=plot(CYD2high,D2fithigh,'k-');
h35=plot(CYD2cross,D2cross,'*k');
grid on; axis tight;
if 0
    h36=text(CYD2pk,D2pk(igoodpk),...
    [strvcat(regexprep(NAME(igoodpk)',...
    '.*play([^_]*_).*','$1')) repmat('  ',length(mats),1)],'Rotation',90,...
    'Horizontal','right');
end
grid on;
if ~any(isnan([coefD2low coefD2high]))
    legend([h31 h33 h34 h35],'Data',...
        ['Slope=' num2str(coefD2low(1),3) '^o'],...
        ['Slope=' num2str(coefD2high(1),3) '^o'],...
        ['Min: [' num2str(CYD2min,3) ',' num2str(D2min,3) ']'],...
        'Location','best');
end
ylabel('max_{radius}(%2^{nd} Harm.Dist.)');
xlabel('Mount yaw (^o)');
ht=title({['\rm' NAME{1} ', ' NAME{2} ',... ' NAME{end}]});
hr=righttext({[datestr(now) '   ' pwdshort(2,which(mfilename))]});

keyboard







