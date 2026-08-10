function [eps]=baerwaldTE(r,L,OA,OH,LO,plotflag);
%From JR's "Copy of Baerwald-Lofgren B Calculator MASTER.xlsx"
% but can disagree in 4th digit, and agrees with Fred's baerwaldTE00.m
% I believe CCW is positive for angles in these published equations,
% Matlab, and in the original published picture
% ...04 2024 11 23: call overhang OH
%       *********LENGTH UNITS = MM***************
mfile=mfilename;
% UPSTAIRS
if nargin<1, r=[]; end
if isempty(r), r=57:146; end %120.9; % outer null mm, 146; %outer radius, groove radius
if nargin<2, L=[]; end
if isempty(L) L=280; end %; %length 235
if nargin<3 OA=[]; end
if isempty(OA) OA=19.495; end %19.495 degrees;
if nargin<4 OH=[]; end
if isempty(OH) OH=14.630; end %mm, 17.638 overhang
if nargin<5, LO=[]; end %lathe centering error, line of stylus below 
%  spindle center, towards the front of the lathe
if isempty(LO), LO=0; end
if nargin<6, plotflag=0; end
PS=L-OH;
D=L-OH; %mm, distance pivot to spindle
%spindle at [0 0], pivot at [0 L-OH]=[0 D]
eps=asind((r.^2+L.^2-PS^2)./(2*r*L))-OA-asind(LO./r);
% asind(LO/r) is the clockwise 

if plotflag,
  order=5;
  coef=polyfit(r,eps,order);
  fit=polyval(coef,r);
  figure;
  plot(r,eps,'.','Markersize',12);
  grid on; hold on;
  plot(r,fit,':','Color',green,'Linewidth',2);
  xlabel(['Playing Radius (mm), Min=' num2str(min(eps),3) '^o, Max='...
      num2str(max(eps),3) '^o, Rng=' num2str(max(eps)-min(eps),3) '^o'])
  ylabel('Tracking Error (^o)');
  title({'Baerwald',['Length=' num2str(L) 'mm, Offset Angle='...
      num2str(OA) '^o, Overhang=' num2str(OH) 'mm']});
  legend('Calc',['Order ' int2str(order) ' fit'],'Location','best')
  Mfile=dir(which(mfile));
  righttext({pwdshort(3,which(mfile)),Mfile.date});
end
if nargout<1, eps=[]; end
