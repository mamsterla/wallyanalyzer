function halffig(name,fig)
  if nargin<2,
    fig=gcf;
  end
  pos=get(gcf,'pos');
  %set(gcf,'position',[ pos(1:2)   360   450])
  set(gcf,'position',[ 5 50   460 576])
  if nargin>0,
    set(gcf,'Name',name);
  end